#!/usr/bin/env python3
"""
parse_result.py <chunk_id> [result_file] — claude -p 번역 출력을 검증·저장한다.

- 입력: stdin 또는 result_file 의 텍스트(또는 claude --output-format json 봉투).
- 검증: translations 의 id 집합이 청크 segment id 집합과 일치하는지.
- 저장: data/translations/<chunk_id>.jsonl  (각 줄에 status/revision 부가)
- 머지: new_terms 를 glossary.json 에 추가(review=true, locked=false; 기존 키는 건드리지 않음)
- 보고: register_checks, 경고를 stderr 로.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TR = DATA / "translations"


def extract_json(text):
    text = text.strip()
    # claude --output-format json 봉투면 result 필드를 꺼낸다
    try:
        env = json.loads(text)
        if isinstance(env, dict) and "result" in env and "translations" not in env:
            text = env["result"]
    except Exception:
        pass
    # 코드펜스 제거
    text = re.sub(r"^```(json)?", "", text.strip())
    text = re.sub(r"```$", "", text.strip())
    # 첫 { 부터 첫 완결 JSON 객체만 파싱(뒤에 설명/잡문이 붙어도 무시 — "Extra data" 방지).
    a = text.find("{")
    if a < 0:
        raise json.JSONDecodeError("no JSON object found", text, 0)
    try:
        obj, _ = json.JSONDecoder().raw_decode(text[a:])
        return obj
    except json.JSONDecodeError:
        # 폴백: 첫 { ~ 마지막 } 구간 재시도(앞부분이 잘린 경우 대비).
        b = text.rfind("}")
        return json.loads(text[a:b + 1])


def main():
    chunk_id = sys.argv[1]
    raw = Path(sys.argv[2]).read_text(encoding="utf-8") if len(sys.argv) > 2 else sys.stdin.read()
    res = extract_json(raw)

    chunk = json.loads((DATA / "chunks" / f"{chunk_id}.json").read_text(encoding="utf-8"))
    want = [s["id"] for s in chunk["segments"]]
    got = [t["id"] for t in res["translations"]]
    warn = []
    if set(got) != set(want):
        warn.append(f"id mismatch: missing={set(want)-set(got)} extra={set(got)-set(want)}")
    if got != want:
        warn.append("순서가 원본과 다름(정렬해 저장).")

    by_id = {t["id"]: t for t in res["translations"]}
    TR.mkdir(parents=True, exist_ok=True)
    out = TR / f"{chunk_id}.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for sid in want:
            t = by_id.get(sid)
            if not t:
                f.write(json.dumps({"id": sid, "status": "untranslated", "runs": []}, ensure_ascii=False) + "\n")
                continue
            rec = {
                "id": sid,
                "status": "translated",
                "runs": t.get("runs", []),
                "speaker": t.get("speaker"),
                "addressee": t.get("addressee"),
                "register": t.get("register"),
                "glossary_used": t.get("glossary_used", []),
                "translator_note": t.get("translator_note"),
                "revision": 1,
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # 신규 용어 머지
    gl_path = DATA / "glossary.json"
    gl = json.loads(gl_path.read_text(encoding="utf-8"))
    added = []
    for nt in res.get("new_terms", []):
        en = nt.get("en", "").strip()
        if not en or en in gl:
            continue
        gl[en] = {
            "ko": nt.get("ko", ""),
            "strategy": "transliterate" if nt.get("type") in ("proper", "neologism") else "translate",
            "type": nt.get("type", "neologism"),
            "first_mark": {"en": True},
            "note": nt.get("note", ""),
            "note_level": "science" if nt.get("type") == "science" else "spoiler-safe",
            "first_seen": None,
            "locked": False,
            "review": True,
        }
        added.append(en)
    if added:
        gl_path.write_text(json.dumps(gl, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[{chunk_id}] saved {len(want)} segs | new_terms +{len(added)} {added}", file=sys.stderr)
    for c in res.get("register_checks", []):
        print(f"  register: {c}", file=sys.stderr)
    for w in warn:
        print(f"  WARN: {w}", file=sys.stderr)


if __name__ == "__main__":
    main()
