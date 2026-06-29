#!/usr/bin/env python3
"""
classify_italics.py — 번역 데이터의 미분류 이탤릭(run.i==true)을 목적별 종류로 분류한다.

종류: thought | emphasis | foreign | title | comm | other  (reader.css / build_reader.italic_class 와 정합)

전략(토큰 최소화):
  Stage 1  glossary 자동: 함선·천체·작품명(TITLE_SET)은 Python 으로 무비용 → title.
  Stage 2  LLM: 미해결 '영어' 이탤릭만 문장 단위로 묶어 claude -p 분류(영어 원문 근거, 출력은 분류만).
  Stage 3  정렬: 영어 분류를 한국어 run 에 적용. 단일은 자명. 복수는 title 제거 후
           '남은 종류가 동일'하면 어순 무관 일괄. 혼합/불일치만 Stage 4.
  Stage 4  LLM(소수): 혼합 복수 segment 만 영어+한국어 함께 주고 한국어 run 별 종류를 직접 받음.
  Stage 5  반영: translations/*.jsonl 의 run.i 를 true→문자열로(원본 줄 보존, 텍스트 무변형).

재실행 안전: LLM 결과는 data/.work/italics_cache.json 에 캐시(재실행 시 호출 0).
사용:
  python3 build/classify_italics.py --dry-run            # 쓰기 없이 분포만
  python3 build/classify_italics.py --chunks s0001-s0047 # 일부만
  python3 build/classify_italics.py                      # 전체 적용
  python3 build/classify_italics.py --no-llm             # glossary(title)만
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from translate_split import load_token_env, call_claude, UsageLimitError, DEFAULT_MODEL  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TR = DATA / "translations"
WORK = DATA / ".work"
CACHE = WORK / "italics_cache.json"
UNRESOLVED = DATA / "italics_unresolved.md"

ALLOWED = ("thought", "emphasis", "foreign", "title", "comm", "other")
# build_reader.ITALIC_ALIASES 와 동일 취지(여기서 정규화). 새 별칭은 양쪽에 함께.
ALIASES = {
    "monologue": "thought", "inner": "thought", "flashback": "thought", "memory": "thought",
    "emph": "emphasis", "stress": "emphasis",
    "alien": "foreign", "invented": "foreign", "neologism": "foreign", "term": "foreign",
    "ship": "title", "vessel": "title", "book": "title", "work": "title", "name": "title",
    "radio": "comm", "comms": "comm", "communication": "comm", "transmission": "comm",
}

# Stage 1 자동 title: 함선·천체·작품 이름(영문 ↔ 한국어). glossary 기반 큐레이션.
TITLE_EN = {"Theseus", "Rorschach", "Scylla", "Charybdis", "Big Ben",
            "Burns-Caufield", "Catfish Rising"}
TITLE_KO = {"테세우스", "로르샤흐", "스킬라", "카리브디스", "빅 벤",
            "번스-카우필드", "캣피시 라이징"}

# glossary 용어 → 고정 이탤릭 종류(LLM 추측 무시). ko 기준; en 표기는 glossary 에서 자동 역참조.
# 일반 단어를 특수 의미로 쓴 '용어로서의 이탤릭'(예: topology→위상)은 foreign(특수 어휘)로 고정한다.
# 여기에 ko 만 추가하면 같은 ko 의 모든 영어 표기가 함께 고정된다.
FIXED_KO_EXTRA = {
    "위상": "foreign",       # topology — 갱/마음/사회정서 구조의 특수 용법
}


def build_fixed_maps():
    """(fixed_ko, fixed_en) 반환. title 집합 + EXTRA + glossary 역참조(같은 ko 의 모든 en)."""
    fixed_ko = dict.fromkeys(TITLE_KO, "title")
    fixed_ko.update(FIXED_KO_EXTRA)
    fixed_en = dict.fromkeys(TITLE_EN, "title")
    gl = json.loads((DATA / "glossary.json").read_text(encoding="utf-8"))
    for en, e in gl.items():
        if e.get("ko") in fixed_ko:
            fixed_en[en] = fixed_ko[e["ko"]]
    return fixed_ko, fixed_en

RUBRIC = """당신은 피터 와츠의 소설 *Blindsight* 에서 이탤릭(기울임)으로 강조된 표현의 '목적'을 분류한다.
각 입력 줄은 `<번호>\t<영어 문장>` 이며 분류 대상 이탤릭은 «…» 로 감싸 표시돼 있다.
«…» 안의 표현이 어떤 목적의 이탤릭인지 다음 6종 중 정확히 하나로 분류한다:
- thought  : 입 밖에 내지 않은 생각·내적 독백·회상.
- emphasis : 단어/구절의 강조(말의 힘줌).
- foreign  : 외국어·외계어·작가가 만든 조어/용어.
- title    : 함선·우주선·천체·책 등 작품/고유물의 이름.
- comm     : 무전·통신·인터컴 등으로 '전송된' 말.
- other    : 위 어디에도 안 맞음.
설명·머리말 없이 JSON 객체 하나만 출력한다: {"items":[[번호,"종류"], ...]}
모든 번호에 대해 정확히 하나의 종류를 출력한다."""

RUBRIC_KO = """당신은 피터 와츠 *Blindsight* 한국어 번역에서 이탤릭의 '목적'을 분류한다.
영어 원문(이탤릭에 [종류?] 표시)과 한국어 문장(이탤릭을 ⟦번호:텍스트⟧ 로 표시)을 함께 준다.
한국어 어순이 영어와 달라 순서가 섞일 수 있으니, 의미로 대응시켜 각 ⟦번호⟧ 의 종류를 정한다.
종류: thought|emphasis|foreign|title|comm|other.
설명 없이 JSON 하나만: {"items":[[번호,"종류"], ...]}  (번호는 ⟦⟧ 의 번호)"""


def norm_kind(k):
    k = str(k).strip().lower()
    k = ALIASES.get(k, k)
    return k if k in ALLOWED else "other"


def load_cache():
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def save_cache(c):
    WORK.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(c, ensure_ascii=False, indent=0), encoding="utf-8")


def italic_runs(runs):
    """runs 에서 이탤릭 run 의 (ordinal, run_index, text) 목록(run 순서)."""
    out = []
    for ri, r in enumerate(runs):
        if r.get("i"):
            out.append((len(out), ri, r["t"]))
    return out


def mark_sentence(runs, target_run_index, lq="«", rq="»"):
    """runs 를 이어붙이되 target run 만 «…» 로 감싼다."""
    return "".join((lq + r["t"] + rq) if i == target_run_index else r["t"]
                   for i, r in enumerate(runs))


def llm_call_json(prompt, sys_prompt, model, env, timeout=300, retries=1):
    """call_claude 로 JSON 객체를 받는다(한도 오류는 전파, 그 외 1회 재시도)."""
    last = None
    for _ in range(retries + 1):
        try:
            obj = call_claude(prompt, sys_prompt, model, env, timeout)
            if isinstance(obj, dict) and "items" in obj:
                return obj["items"]
            last = f"예상 밖 출력: {str(obj)[:120]}"
        except UsageLimitError:
            raise
        except Exception as e:  # noqa: BLE001
            last = str(e)[:160]
    raise RuntimeError(f"LLM 분류 실패: {last}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="쓰기 없이 분포만 보고")
    ap.add_argument("--chunks", nargs="*", help="대상 청크(기본 전체)")
    ap.add_argument("--no-llm", action="store_true", help="glossary(title) 자동만")
    ap.add_argument("--batch-size", type=int, default=50)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    args = ap.parse_args()

    segs = {json.loads(l)["id"]: json.loads(l)
            for l in (DATA / "segments.jsonl").read_text(encoding="utf-8").splitlines()}
    seg_order = list(segs.keys())
    seg_pos = {sid: i for i, sid in enumerate(seg_order)}
    manifest = json.loads((DATA / "chunks_manifest.json").read_text(encoding="utf-8"))
    cids = args.chunks or [m["chunk_id"] for m in manifest]
    cids = [c for c in cids if (TR / f"{c}.jsonl").exists()]

    # ── Stage 0: 수집 ──────────────────────────────────────────────
    # tr_seg[sid] = {"file":cid, "ko_runs":[...]}  /  ko_ital[sid]=[(ord,ri,text)]
    tr_seg, ko_ital = {}, {}
    for cid in cids:
        for l in (TR / f"{cid}.jsonl").read_text(encoding="utf-8").splitlines():
            if not l.strip():
                continue
            o = json.loads(l)
            its = italic_runs(o.get("runs", []))
            if its:
                tr_seg[o["id"]] = {"file": cid}
                ko_ital[o["id"]] = its
    print(f"이탤릭 보유 segment: {len(ko_ital)} | 이탤릭 run: {sum(len(v) for v in ko_ital.values())}")

    cache = load_cache()
    fixed_ko, fixed_en = build_fixed_maps()
    en_kind = {}        # f"{sid}#{en_ord}" -> kind   (Stage1 고정 + Stage2 LLM)
    stage1_en = set()   # Stage1 에서 고정된 en key (Stage3 정렬에서 제외)
    resolved = {}       # (sid, ko_ord) -> kind       (최종 한국어 적용)

    # ── Stage 1: glossary 고정 매핑(양쪽) ─────────────────────────
    for sid, kos in ko_ital.items():
        for (ko_ord, _ri, txt) in kos:
            if txt in fixed_ko:
                resolved[(sid, ko_ord)] = fixed_ko[txt]
        for (en_ord, _ri, txt) in italic_runs(segs[sid]["runs"]):
            if txt in fixed_en:
                key = f"{sid}#{en_ord}"
                en_kind[key] = fixed_en[txt]
                stage1_en.add(key)
    from collections import Counter as _C
    print(f"Stage1 glossary 고정: {dict(_C(resolved.values()))}")

    # ── Stage 2: LLM 영어 분류(미해결 영어 이탤릭) ─────────────────
    pending = []  # (key, marked_sentence)
    for sid in ko_ital:
        en_runs = segs[sid]["runs"]
        for (en_ord, ri, _txt) in italic_runs(en_runs):
            key = f"{sid}#{en_ord}"
            if key in en_kind:
                continue
            if key in cache:
                en_kind[key] = cache[key]
                continue
            pending.append((key, mark_sentence(en_runs, ri)))

    if pending and not args.no_llm:
        env = load_token_env()
        print(f"Stage2 LLM 분류 대상 영어 이탤릭: {len(pending)} (배치 {args.batch_size})")
        if args.dry_run:
            print("  (dry-run: LLM 호출 생략)")
        else:
            bs = args.batch_size
            for bi in range(0, len(pending), bs):
                batch = pending[bi:bi + bs]
                lines = [f"{i}\t{sent}" for i, (_k, sent) in enumerate(batch)]
                prompt = "다음 각 줄의 «…» 이탤릭을 분류하라.\n" + "\n".join(lines)
                items = llm_call_json(prompt, RUBRIC, args.model, env)
                got = {int(idx): norm_kind(k) for idx, k in items}
                for i, (key, _sent) in enumerate(batch):
                    kind = got.get(i, "other")
                    en_kind[key] = kind
                    cache[key] = kind
                save_cache(cache)
                print(f"  배치 {bi//bs+1}/{(len(pending)+bs-1)//bs} 완료 ({len(got)}/{len(batch)})")

    # ── Stage 3: 정렬·적용 ─────────────────────────────────────────
    stage4 = []  # 혼합/불일치 segment
    for sid, kos in ko_ital.items():
        en_list = italic_runs(segs[sid]["runs"])
        # 남은(비-title) 한국어/영어
        rem_ko = [ko_ord for (ko_ord, _ri, txt) in kos
                  if (sid, ko_ord) not in resolved]
        rem_en_kinds = [en_kind.get(f"{sid}#{eo}") for (eo, _ri, txt) in en_list
                        if f"{sid}#{eo}" not in stage1_en]
        if not rem_ko:
            continue
        distinct = {k for k in rem_en_kinds if k}
        if len(distinct) == 1 and all(rem_en_kinds) and rem_en_kinds:
            kind = distinct.pop()
            for ko_ord in rem_ko:
                resolved[(sid, ko_ord)] = kind
        else:
            stage4.append(sid)

    # ── Stage 4: 혼합 복수 segment (영어+한국어) ───────────────────
    if stage4 and not args.no_llm and not args.dry_run:
        env = load_token_env()
        print(f"Stage4 혼합 복수 segment: {len(stage4)}")
        for sid in stage4:
            ck = f"{sid}@ko"
            if ck in cache:
                for ko_ord_s, kind in cache[ck].items():
                    resolved[(sid, int(ko_ord_s))] = kind
                continue
            en_runs = segs[sid]["runs"]
            en_marked = "".join(
                (f"[{en_kind.get(f'{sid}#{o}','?')}]{r['t']}[/]" if r.get("i") else r["t"])
                for o, r in _enumerate_italics(en_runs))
            ko_runs_full = _ko_runs(sid, tr_seg, TR)
            # 미해결 한국어 이탤릭만 ⟦번호:텍스트⟧ 로 표시
            ko_marked, order_keys = _mark_ko(sid, ko_ital, ko_runs_full, resolved)
            prompt = (f"영어:\n{en_marked}\n\n한국어:\n{ko_marked}\n\n"
                      "각 ⟦번호⟧ 한국어 이탤릭의 종류를 정하라.")
            try:
                items = llm_call_json(prompt, RUBRIC_KO, args.model, env)
            except UsageLimitError:
                raise
            except Exception as e:  # noqa: BLE001
                print(f"  ! {sid} Stage4 실패: {str(e)[:100]}")
                continue
            res = {}
            for idx, k in items:
                idx = int(idx)
                if idx < len(order_keys):
                    ko_ord = order_keys[idx]
                    kind = norm_kind(k)
                    resolved[(sid, ko_ord)] = kind
                    res[str(ko_ord)] = kind
            cache[ck] = res
            save_cache(cache)
    elif stage4:
        print(f"Stage4 대상 {len(stage4)} segment (dry-run/no-llm: 미처리)")

    # ── 고정 매핑 최종 우선 적용(어떤 단계·캐시 결과도 덮어씀) ───────────
    for sid, kos in ko_ital.items():
        for (ko_ord, _ri, txt) in kos:
            if txt in fixed_ko:
                resolved[(sid, ko_ord)] = fixed_ko[txt]

    # ── 보고 ───────────────────────────────────────────────────────
    from collections import Counter
    total = sum(len(v) for v in ko_ital.values())
    by_kind = Counter(resolved.values())
    unresolved = [(sid, ko_ord, txt) for sid, kos in ko_ital.items()
                  for (ko_ord, _ri, txt) in kos if (sid, ko_ord) not in resolved]
    print(f"\n분류 완료: {len(resolved)}/{total} | 종류별: {dict(by_kind)}")
    print(f"미해결(i:true 유지): {len(unresolved)}")

    if args.dry_run:
        print("\n[dry-run] 쓰기 생략. 예시 미해결:", unresolved[:8])
        return

    # ── Stage 5: 반영 ──────────────────────────────────────────────
    by_file = {}
    for cid in cids:
        by_file.setdefault(cid, True)
    changed_files = 0
    for cid in cids:
        path = TR / f"{cid}.jsonl"
        lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
        out, touched = [], False
        for l in lines:
            o = json.loads(l)
            sid = o["id"]
            if sid in ko_ital:
                ko_ord = 0
                before = "".join(r["t"] for r in o["runs"])
                for r in o["runs"]:
                    if r.get("i"):
                        kind = resolved.get((sid, ko_ord))
                        if kind:
                            r["i"] = kind
                            touched = True
                        ko_ord += 1
                assert "".join(r["t"] for r in o["runs"]) == before, f"{sid} 텍스트 변형"
            out.append(json.dumps(o, ensure_ascii=False))
        if touched:
            shutil.copy(path, WORK / f"{cid}.jsonl.preital")
            path.write_text("\n".join(out) + "\n", encoding="utf-8")
            changed_files += 1
    print(f"반영: {changed_files}개 파일 갱신(백업 .work/*.preital)")

    if unresolved:
        L = [f"# 미분류 이탤릭 — {len(unresolved)}건 (i:true 유지, 사람 검토)\n",
             "| chunk | id | ko_ord | 텍스트 |", "|---|---|---|---|"]
        sid2file = {sid: tr_seg[sid]["file"] for sid in tr_seg}
        for sid, ko_ord, txt in unresolved:
            L.append(f"| {sid2file.get(sid,'?')} | {sid} | {ko_ord} | {txt} |")
        UNRESOLVED.write_text("\n".join(L) + "\n", encoding="utf-8")
        print(f"미해결 목록 → {UNRESOLVED}")


# ── Stage4 보조 ────────────────────────────────────────────────────
def _enumerate_italics(runs):
    o = 0
    for r in runs:
        if r.get("i"):
            yield o, r
            o += 1
        else:
            yield -1, r


def _ko_runs(sid, tr_seg, TR):
    cid = tr_seg[sid]["file"]
    for l in (TR / f"{cid}.jsonl").read_text(encoding="utf-8").splitlines():
        if l.strip() and json.loads(l)["id"] == sid:
            return json.loads(l)["runs"]
    return []


def _mark_ko(sid, ko_ital, ko_runs, resolved):
    """미해결 한국어 이탤릭만 ⟦n:텍스트⟧ 로 표시. (표시문자열, [ko_ord...]) 반환."""
    parts, order_keys = [], []
    ko_ord = 0
    for r in ko_runs:
        if r.get("i"):
            if (sid, ko_ord) not in resolved:
                parts.append(f"⟦{len(order_keys)}:{r['t']}⟧")
                order_keys.append(ko_ord)
            else:
                parts.append(r["t"])
            ko_ord += 1
        else:
            parts.append(r["t"])
    return "".join(parts), order_keys


if __name__ == "__main__":
    try:
        main()
    except UsageLimitError as e:
        # 한도 도달: 진행분은 캐시에 저장됨. 한도 리셋 후 같은 명령 재실행이면 이어서.
        print(f"  ! 사용량 한도 — 중단(캐시까지 저장됨, 재실행으로 이어서): {e}", file=sys.stderr)
        sys.exit(3)
