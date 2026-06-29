#!/usr/bin/env python3
"""
make_prompt.py <chunk.json> — 한 청크의 번역용 입력 JSON을 stdout 으로 출력한다.

주입 컨텍스트(설계서 §3 번역 루프 1단계):
  - glossary: 확정(locked) 용어 en/ko/type
  - register_matrix + characters: 말투 기준
  - context: 직전 청크의 마지막 문단들(번역본 있으면 번역본, 없으면 원문)
  - segments: 이번 청크 segment (id/kind/align/runs)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TR = DATA / "translations"
CONTEXT_TAIL = 3  # 직전 청크에서 가져올 문단 수


def main():
    chunk_path = Path(sys.argv[1])
    chunk = json.loads(chunk_path.read_text(encoding="utf-8"))

    gl = json.loads((DATA / "glossary.json").read_text(encoding="utf-8"))
    locked = [
        {"en": en, "ko": e["ko"], "type": e["type"]}
        for en, e in gl.items()
        if e.get("locked")
    ]
    chars = json.loads((DATA / "characters.json").read_text(encoding="utf-8"))

    # 직전 청크 꼬리(연속성). manifest 순서로 직전 청크를 찾는다.
    manifest = json.loads((DATA / "chunks_manifest.json").read_text(encoding="utf-8"))
    ids = [m["chunk_id"] for m in manifest]
    context = []
    if chunk["chunk_id"] in ids:
        i = ids.index(chunk["chunk_id"])
        if i > 0:
            prev_id = ids[i - 1]
            prev = json.loads((DATA / "chunks" / f"{prev_id}.json").read_text(encoding="utf-8"))
            tail = prev["segments"][-CONTEXT_TAIL:]
            tr_path = TR / f"{prev_id}.jsonl"
            tr = {}
            if tr_path.exists():
                for line in tr_path.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        o = json.loads(line)
                        tr[o["id"]] = "".join(r["t"] for r in o["runs"])
            for s in tail:
                context.append({
                    "id": s["id"],
                    "ko": tr.get(s["id"]),          # 번역본(있으면)
                    "en": None if s["id"] in tr else s["text"],  # 없으면 원문
                })

    out = {
        "glossary": locked,
        "register_matrix": chars["register_matrix"],
        "characters": chars["characters"],
        "context": context,
        "segments": [
            {"id": s["id"], "kind": s["kind"], "align": s["align"], "runs": s["runs"]}
            for s in chunk["segments"]
        ],
    }
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
