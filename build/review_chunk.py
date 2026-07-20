#!/usr/bin/env python3
"""
review_chunk.py <chunk_id> — 한 청크의 번역을 품질+이탤릭 용도 관점에서 감수한다.

입력은 평문 `(id + 원문EN + 번역KO)` 리스트(JSON 구조 문자 없음), 출력은
문제/오분류 문장만 `id<TAB>개선문`. 원 번역보다 토큰이 크게 준다.
이탤릭 강조는 마커로 왕복: 원문 `*텍스트*`, 번역 `*코드:텍스트*`(t/e/f/ti/c/o).

- claude -p 호출·인증·한도 감지는 translate 계열과 동일 방식.
- 확정분은 translations/<cid>.jsonl 갱신(runs 교체·revision+1), 원본은 review_backup/ 보존.
- 완료 시 .work/<cid>.reviewed 생성(review.sh 재개용).
- DRY=1 이면 적용하지 않고 요약만 출력(드라이런).

사용:
  python3 build/review_chunk.py s0001-s0047
  DRY=1 MODEL=opus python3 build/review_chunk.py s0001-s0047
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TR = DATA / "translations"
WORK = DATA / ".work"
BACKUP = DATA / "review_backup"
SYS_MD = (ROOT / "build" / "review_system.md").read_text(encoding="utf-8")
DEFAULT_MODEL = os.environ.get("MODEL", "sonnet")
TIMEOUT = int(os.environ.get("REVIEW_TIMEOUT", 900))
DRY = os.environ.get("DRY") == "1"

KIND2CODE = {"thought": "t", "emphasis": "e", "foreign": "f",
             "title": "ti", "comm": "c", "other": "o"}
CODE2KIND = {"t": "thought", "e": "emphasis", "f": "foreign",
             "ti": "title", "c": "comm", "o": "other", "?": True}
MARK = re.compile(r"\*([^*]*)\*")
INNER = re.compile(r"^(ti|[tefco?]):(.*)$", re.S)


class UsageLimitError(Exception):
    """사용량/인증 한도 — 전체 중단 신호(exit 3)."""


_LIMIT_SIGNS = ("usage limit", "session limit", "limit reached", "rate limit",
                "rate_limit", "429", "quota", "insufficient", "credit balance",
                "authentication", "oauth", "unauthorized", "401", "403")


def load_token_env():
    env = os.environ.copy()
    tok = ROOT / "CLAUDE_CODE_OAUTH_TOKEN"
    if tok.exists():
        env["CLAUDE_CODE_OAUTH_TOKEN"] = tok.read_text(encoding="utf-8").strip()
    return env


# ── 이탤릭 마커 ↔ runs ──────────────────────────────────────────────
def runs_to_marked_en(runs):
    """원문 runs → 평문(이탤릭은 *텍스트*, 용도 구분 없음)."""
    out = []
    for r in runs:
        out.append(f"*{r['t']}*" if r.get("i") else r["t"])
    return "".join(out)


def runs_to_marked_ko(runs):
    """번역 runs → 평문(강조는 *코드:텍스트*)."""
    out = []
    for r in runs:
        i = r.get("i")
        if i:
            code = KIND2CODE.get(i if i is not True else None, "?")
            out.append(f"*{code}:{r['t']}*")
        else:
            out.append(r["t"])
    return "".join(out)


def marked_to_runs(s):
    """개선문(*코드:텍스트*) → runs. 코드 미상/`?`는 i:true(재확인 대상)로 둔다.
    반환: (runs, unresolved_bool)."""
    runs, pos, unresolved = [], 0, False
    for m in MARK.finditer(s):
        if m.start() > pos:
            runs.append({"t": s[pos:m.start()]})
        inner = m.group(1)
        mm = INNER.match(inner)
        code, text = (mm.group(1), mm.group(2)) if mm else ("?", inner)
        kind = CODE2KIND.get(code, True)
        run = {"t": text}
        if kind is True:
            run["i"] = True
            unresolved = True
        else:
            run["i"] = kind
        runs.append(run)
        pos = m.end()
    if pos < len(s):
        runs.append({"t": s[pos:]})
    runs = [r for r in runs if r["t"] != ""]
    return runs, unresolved


# 마커 밖 텍스트에 코드 접두어(예: "e:", "t:")가 새어 나왔는지 탐지
_LEAK = re.compile(r"(?:^|[\s(\"'가-힣])(ti|[tefco]):")


def marker_issues(raw):
    """개선문의 마커 구조를 검증한다. 문제가 있으면 사유 문자열, 없으면 None.
    모델이 마커를 잘못 쓰면(홀수 *, 코드 없는 마커, 빈 강조, 코드 접두어 잔류)
    본문이 오염되므로 그런 변경은 적용하지 않고 원본을 유지한다."""
    if raw.count("*") % 2 != 0:
        return "홀수 개 *"
    for m in MARK.finditer(raw):
        mm = INNER.match(m.group(1))
        if not mm:
            return f"코드 없는 마커({m.group(1)[:12]!r})"
        if mm.group(1) == "?" or not mm.group(2).strip():
            return "빈/미분류 강조"
    if _LEAK.search(MARK.sub("", raw)):
        return "코드 접두어 잔류"
    return None


# ── claude 호출 ─────────────────────────────────────────────────────
def _err_text(proc):
    parts = []
    out = proc.stdout.strip()
    if out:
        try:
            env = json.loads(out)
            parts.append(str(env.get("result") or env.get("error") or out))
        except Exception:
            parts.append(out)
    if proc.stderr.strip():
        parts.append("stderr=" + proc.stderr.strip())
    return " | ".join(parts)[:500] or "(빈 출력)"


def call_claude(prompt_text, sys_prompt, model, env):
    proc = subprocess.run(
        ["claude", "-p", "--model", model,
         "--append-system-prompt", sys_prompt, "--output-format", "json"],
        input=prompt_text, capture_output=True, text=True, env=env, timeout=TIMEOUT,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        msg = _err_text(proc)
        if any(s in msg.lower() for s in _LIMIT_SIGNS):
            raise UsageLimitError(msg)
        raise RuntimeError(f"claude exit {proc.returncode}: {msg}")
    envj = json.loads(proc.stdout)
    return envj.get("result", ""), envj.get("usage") or {}, envj.get("total_cost_usd")


def build_fixed_block():
    """일관성 기준이 되는 전체 glossary + characters 블록(모든 청크 공통 → 캐시 프리픽스).
    ARG_MAX(단일 인자 128KB) 회피를 위해 이 큰 데이터는 시스템 프롬프트가 아니라
    stdin(사용자 메시지) 맨 앞에 둔다. 규칙(review_system.md)만 --append-system-prompt 로 넘긴다."""
    GL_KEEP = ("ko", "strategy", "type", "aliases", "coinage", "note", "locked")
    gl = json.loads((DATA / "glossary.json").read_text(encoding="utf-8"))
    glossary = []
    for en, e in gl.items():
        item = {"en": en}
        for k in GL_KEEP:
            if e.get(k) not in (None, "", [], False):
                item[k] = e[k]
        glossary.append(item)
    chars = json.loads((DATA / "characters.json").read_text(encoding="utf-8"))
    fixed = {"glossary": glossary, "characters": chars}
    return ("## 고정 참고 데이터(모든 입력 공통 · 일관성 기준)\n"
            + "아래는 전체 용어집(glossary)과 인물/말투 데이터(characters: register_matrix·"
            + "characters·register_events 포함)다. 용어 표기·전략·조어 구분·말투를 이 기준에 "
            + "일관되게 맞춰 감수한다. locked 용어의 ko 는 반드시 그대로 유지한다.\n"
            + json.dumps(fixed, ensure_ascii=False))


def build_prompt_text(chunk_id):
    """청크의 (id, EN, KO) 평문 블록. scene-break 제외. 반환: (본문, 검토대상 id 리스트)."""
    segs = {json.loads(l)["id"]: json.loads(l)
            for l in (DATA / "segments.jsonl").read_text(encoding="utf-8").splitlines()}
    chunk = json.loads((DATA / "chunks" / f"{chunk_id}.json").read_text(encoding="utf-8"))
    tr = {}
    for l in (TR / f"{chunk_id}.jsonl").read_text(encoding="utf-8").splitlines():
        if l.strip():
            o = json.loads(l)
            tr[o["id"]] = o
    blocks, ids = [], []
    for s in chunk["segments"]:
        sid = s["id"]
        src = segs[sid]
        if src.get("kind") == "scene-break":
            continue
        t = tr.get(sid)
        if not t:
            continue
        en = runs_to_marked_en(src["runs"])
        ko = runs_to_marked_ko(t.get("runs", []))
        blocks.append(f"{sid}\nEN: {en}\nKO: {ko}")
        ids.append(sid)
    header = ("아래 세그먼트들을 감수하라. 개선이 필요하거나 이탤릭 용도 코드가 틀린 "
              "문장만 `id<TAB>개선문`으로 출력하라(문제없으면 빈 출력).\n\n")
    # 고정 데이터(캐시 프리픽스)를 맨 앞에, 그 뒤 이 청크의 세그먼트.
    return build_fixed_block() + "\n\n" + header + "\n\n".join(blocks), ids


def parse_output(text, valid_ids):
    """모델 출력에서 `id<TAB>개선문` 줄만 추출. 반환: {id: 개선문}."""
    valid = set(valid_ids)
    out = {}
    for line in text.splitlines():
        if "\t" not in line:
            continue
        sid, _, improved = line.partition("\t")
        sid, improved = sid.strip(), improved.strip()
        if sid in valid and improved:
            out[sid] = improved
    return out


def main():
    chunk_id = sys.argv[1]
    model = DEFAULT_MODEL
    WORK.mkdir(parents=True, exist_ok=True)
    marker = WORK / f"{chunk_id}.reviewed"

    prompt_text, ids = build_prompt_text(chunk_id)
    if not ids:
        print(f"[{chunk_id}] 검토 대상 없음(scene-break만?) — skip", file=sys.stderr)
        marker.write_text("empty", encoding="utf-8")
        return
    sys_prompt = SYS_MD   # 규칙만 시스템 프롬프트로(작음). 고정 데이터는 prompt_text 앞에.
    print(f"[{chunk_id}] {len(ids)} segs 감수 중 (model {model}, "
          f"{'DRY' if DRY else 'APPLY'})...", file=sys.stderr)

    result_text, usage, cost = call_claude(prompt_text, sys_prompt, model, load_token_env())
    if os.environ.get("REVIEW_DEBUG") == "1":
        print("===== RAW RESULT =====", file=sys.stderr)
        print(result_text, file=sys.stderr)
        print("===== /RAW =====", file=sys.stderr)
    changes = parse_output(result_text, ids)

    # 번역 파일 로드(순서 보존)
    tr_path = TR / f"{chunk_id}.jsonl"
    records = [json.loads(l) for l in tr_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    by_id = {r["id"]: r for r in records}

    rejected = []
    applied = 0
    samples = []
    for sid, improved in changes.items():
        rec = by_id.get(sid)
        if not rec:
            continue
        issue = marker_issues(improved)          # 마커 오염 검증 — 문제 시 적용 안 함(원본 유지)
        if issue:
            rejected.append((sid, issue))
            continue
        old_ko = runs_to_marked_ko(rec.get("runs", []))
        new_runs, _ = marked_to_runs(improved)
        if not new_runs:
            continue
        # 자기검증: 파싱한 runs 를 다시 마커로 직렬화해 모델 출력과 정확히 일치해야 한다.
        # 불일치 = 파싱이 손상됐다는 뜻(글자 누락·마커 어긋남 등) → 적용하지 않고 원본 유지.
        if runs_to_marked_ko(new_runs) != improved:
            rejected.append((sid, "라운드트립 불일치"))
            continue
        if len(samples) < 8:
            samples.append((sid, old_ko, improved))
        if not DRY:
            rec["runs"] = new_runs
            rec["revision"] = (rec.get("revision") or 1) + 1
            note = rec.get("translator_note")
            tag = "감수: 품질/이탤릭 재검토"
            rec["translator_note"] = (note + " | " + tag) if note else tag
        applied += 1

    # 요약 출력 (캐시 필드 포함 — input_tokens 는 비캐시분만이라 작게 보인다)
    ut = (f"in={usage.get('input_tokens','?')} "
          f"cache_r={usage.get('cache_read_input_tokens', 0)} "
          f"cache_w={usage.get('cache_creation_input_tokens', 0)} "
          f"out={usage.get('output_tokens','?')}")
    print(f"[{chunk_id}] 변경 {applied}/{len(ids)} · 거부(마커오염) {len(rejected)} · "
          f"tokens {ut}" + (f" · ${cost}" if cost else ""), file=sys.stderr)
    for sid, old, new in samples:
        print(f"   {sid}\n     - {old}\n     + {new}", file=sys.stderr)
    if rejected:
        print("   거부(원본 유지): " + ", ".join(f"{s}({r})" for s, r in rejected), file=sys.stderr)

    if DRY:
        print(f"[{chunk_id}] DRY — 적용하지 않음", file=sys.stderr)
        return

    # 원본 백업(비파괴) 후 적용
    BACKUP.mkdir(parents=True, exist_ok=True)
    bpath = BACKUP / f"{chunk_id}.jsonl"
    if not bpath.exists():
        bpath.write_text(tr_path.read_text(encoding="utf-8"), encoding="utf-8")
    tr_path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n",
        encoding="utf-8")
    marker.write_text(f"applied={applied} rejected={len(rejected)}", encoding="utf-8")
    print(f"[{chunk_id}] 적용 완료 — {applied}건 반영, 원본 {bpath.name} 백업", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except UsageLimitError as e:
        print(f"  ! 사용량/한도 도달 — 전체 중단: {e}", file=sys.stderr)
        sys.exit(3)
