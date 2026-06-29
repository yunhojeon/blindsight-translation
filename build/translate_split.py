#!/usr/bin/env python3
"""
translate_split.py <chunk_id> [batch_size] — 큰 청크를 작은 배치로 나눠 번역한다.

배경: claude -p 가 큰 배치(수십 segment)를 한 번에 번역하면 응답을 끝맺지 못하고
폭주(장시간/출력 토큰 초과)하는 경우가 있다. 작은 배치(기본 6 segment)는 안정적이므로
청크를 배치로 쪼개 각각 호출하고, 결과를 하나로 합쳐 기존 parse_result.py 에 넘긴다.

- chunk_id / segment id 는 그대로 유지된다(빌드·공유 URL 영향 없음).
- 배치별 호출은 .work/<chunk>.b<k>.json 에 캐시 → 재실행 시 성공한 배치는 건너뛴다.
- 연속성: 첫 배치는 직전 청크 꼬리를, 이후 배치는 직전 배치의 마지막 문단을 context 로 받는다.
- 최종 병합본은 parse_result.py 가 검증(id 일치)·glossary 머지·jsonl 저장까지 수행한다.

사용:
  python3 build/translate_split.py s0149-s0181        # 기본 배치 6
  python3 build/translate_split.py s0149-s0181 8
  BATCH=5 python3 build/translate_split.py s0149-s0181
"""
import json
import os
import subprocess
import sys
from pathlib import Path

# parse_result 의 견고한 JSON 추출 로직을 그대로 재사용한다.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse_result import extract_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TR = DATA / "translations"
WORK = DATA / ".work"
SYS_MD = (ROOT / "build" / "translate_system.md").read_text(encoding="utf-8")
CONTEXT_TAIL = 3
DEFAULT_MODEL = os.environ.get("MODEL", "sonnet")  # 번역 모델(기본 Sonnet). 'opus' 등으로 변경 가능.


def build_system_prompt(locked, chars):
    """고정 참고 데이터(glossary/register_matrix/characters)를 시스템 프롬프트에 싣는다.
    모든 배치에 동일 → 캐시되는 프리픽스가 되어 매 배치 fresh 입력으로 재전송하지 않는다."""
    fixed = {
        "glossary": locked,
        "register_matrix": chars["register_matrix"],
        "characters": chars["characters"],
    }
    return (SYS_MD
            + "\n\n## 고정 참고 데이터(모든 입력 공통)\n"
            + "아래 glossary·register_matrix·characters 는 매 입력마다 동일하게 적용한다. "
            + "사용자 입력에는 context 와 segments 만 온다.\n"
            + json.dumps(fixed, ensure_ascii=False))


def load_token_env():
    """translate.sh 와 동일하게 토큰 파일이 있으면 환경변수로 로드."""
    env = os.environ.copy()
    tok = ROOT / "CLAUDE_CODE_OAUTH_TOKEN"
    if tok.exists():
        env["CLAUDE_CODE_OAUTH_TOKEN"] = tok.read_text(encoding="utf-8").strip()
    return env


def base_context(chunk_id):
    """첫 배치용 context: 직전 청크의 마지막 문단들(번역본 있으면 번역본)."""
    manifest = json.loads((DATA / "chunks_manifest.json").read_text(encoding="utf-8"))
    ids = [m["chunk_id"] for m in manifest]
    if chunk_id not in ids:
        return []
    i = ids.index(chunk_id)
    if i == 0:
        return []
    prev_id = ids[i - 1]
    prev = json.loads((DATA / "chunks" / f"{prev_id}.json").read_text(encoding="utf-8"))
    tail = prev["segments"][-CONTEXT_TAIL:]
    tr = {}
    tr_path = TR / f"{prev_id}.jsonl"
    if tr_path.exists():
        for line in tr_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                o = json.loads(line)
                tr[o["id"]] = "".join(r["t"] for r in o["runs"])
    return [
        {"id": s["id"], "ko": tr.get(s["id"]),
         "en": None if s["id"] in tr else s["text"]}
        for s in tail
    ]


def batch_context(prev_segments):
    """이후 배치용 context: 직전 배치의 마지막 원문 문단들(연속성 참고)."""
    return [
        {"id": s["id"], "ko": None, "en": s["text"]}
        for s in prev_segments[-CONTEXT_TAIL:]
    ]


def build_prompt(context, segments):
    # 고정 데이터(glossary/matrix/characters)는 시스템 프롬프트로 옮겼다(캐시). 여기엔 가변분만.
    return {
        "context": context,
        "segments": [
            {"id": s["id"], "kind": s["kind"], "align": s["align"], "runs": s["runs"]}
            for s in segments
        ],
    }


class UsageLimitError(Exception):
    """사용량/레이트 한도 도달. 재시도·다음 청크 진행 모두 무의미하므로 전체 중단 신호."""


# claude 가 한도/인증 문제로 거부할 때 stdout(json envelope) 또는 stderr 에 나타나는 신호.
_LIMIT_SIGNS = ("usage limit", "session limit", "limit reached", "limit ·", "limit·",
                "rate limit", "rate_limit", "429", "quota", "insufficient",
                "credit balance", "authentication", "oauth", "unauthorized", "401", "403")


def _claude_error_text(proc):
    """실패한 호출에서 사람이 읽을 에러 텍스트를 stdout(result 필드)+stderr 로 합쳐 만든다."""
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


def call_claude(prompt_text, sys_prompt, model, env, timeout):
    """claude -p 호출(타임아웃 적용). translations 추출본 반환. 실패 시 예외."""
    proc = subprocess.run(
        ["claude", "-p", "--model", model,
         "--append-system-prompt", sys_prompt, "--output-format", "json"],
        input=prompt_text, capture_output=True, text=True, env=env, timeout=timeout,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        msg = _claude_error_text(proc)
        if any(s in msg.lower() for s in _LIMIT_SIGNS):
            raise UsageLimitError(msg)
        raise RuntimeError(f"claude exit {proc.returncode}: {msg}")
    return extract_json(proc.stdout)


def translate_batch(prompt, sys_prompt, model, env, timeout, retries=1):
    """배치 1개를 번역한다. 타임아웃/오류 시 최대 retries 회 재시도. 한도 오류는 즉시 전파."""
    last = None
    for attempt in range(retries + 1):
        try:
            return call_claude(json.dumps(prompt, ensure_ascii=False),
                               sys_prompt, model, env, timeout)
        except UsageLimitError:
            raise  # 재시도 무의미 — 전체 중단으로 올린다
        except subprocess.TimeoutExpired:
            last = f"{timeout}s 타임아웃(폭주 의심)"
        except Exception as e:  # noqa: BLE001
            last = str(e)[:300]
        if attempt < retries:
            print(f"      재시도({attempt+1}/{retries}) — 직전 실패: {last}", file=sys.stderr)
    raise RuntimeError(f"배치 번역 실패: {last}")


def main():
    chunk_id = sys.argv[1]
    bs = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.environ.get("BATCH", 10))
    model = DEFAULT_MODEL
    # 배치당 상한(초). Sonnet 은 세그당 ~30s 라 10-seg≈5분. 진짜 폭주(수십 분)만 차단하도록 여유.
    timeout = int(os.environ.get("BATCH_TIMEOUT", 600))
    env = load_token_env()
    WORK.mkdir(parents=True, exist_ok=True)
    TR.mkdir(parents=True, exist_ok=True)

    chunk = json.loads((DATA / "chunks" / f"{chunk_id}.json").read_text(encoding="utf-8"))
    segs = chunk["segments"]
    gl = json.loads((DATA / "glossary.json").read_text(encoding="utf-8"))
    locked = [{"en": en, "ko": e["ko"], "type": e["type"]}
              for en, e in gl.items() if e.get("locked")]
    chars = json.loads((DATA / "characters.json").read_text(encoding="utf-8"))
    sys_prompt = build_system_prompt(locked, chars)  # 고정 데이터 포함, 모든 배치 공통(캐시)

    batches = [segs[i:i + bs] for i in range(0, len(segs), bs)]
    print(f"[{chunk_id}] {len(segs)} segs → {len(batches)} batches (size {bs}, model {model})", file=sys.stderr)

    all_tr, new_terms, reg_checks = [], [], []
    for k, batch in enumerate(batches):
        cache = WORK / f"{chunk_id}.b{k}.json"
        if cache.exists() and cache.stat().st_size > 0:
            res = json.loads(cache.read_text(encoding="utf-8"))
            print(f"  batch {k+1}/{len(batches)} ({batch[0]['id']}..{batch[-1]['id']}) — 캐시 사용", file=sys.stderr)
        else:
            ctx = base_context(chunk_id) if k == 0 else batch_context(batches[k - 1])
            prompt = build_prompt(ctx, batch)
            print(f"  batch {k+1}/{len(batches)} ({batch[0]['id']}..{batch[-1]['id']}) — 번역 중...", file=sys.stderr)
            res = translate_batch(prompt, sys_prompt, model, env, timeout)
            cache.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
        got = {t["id"] for t in res.get("translations", [])}
        want = {s["id"] for s in batch}
        if got != want:
            raise SystemExit(f"  x batch {k+1} id 불일치: 누락={want-got} 잉여={got-want}")
        all_tr.extend(res["translations"])
        new_terms.extend(res.get("new_terms", []))
        reg_checks.extend(res.get("register_checks", []))

    combined = {"translations": all_tr, "new_terms": new_terms, "register_checks": reg_checks}
    comb_path = WORK / f"{chunk_id}.combined.json"
    comb_path.write_text(json.dumps(combined, ensure_ascii=False), encoding="utf-8")

    # 최종 검증·저장·glossary 머지는 기존 parse_result.py 에 위임
    r = subprocess.run([sys.executable, str(ROOT / "build" / "parse_result.py"),
                        chunk_id, str(comb_path)])
    if r.returncode != 0:
        raise SystemExit(f"  x parse_result 실패 (exit {r.returncode})")
    print(f"[{chunk_id}] 완료 — {len(all_tr)} segs, new_terms {len(new_terms)}", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except UsageLimitError as e:
        # 사용량/인증 한도. 남은 청크 진행은 무의미하므로 전용 코드(3)로 빠진다.
        print(f"  ! 사용량/한도 도달 — 전체 중단: {e}", file=sys.stderr)
        sys.exit(3)
