#!/usr/bin/env python3
"""
chunk.py — segments.jsonl 을 번역 단위(청크)로 분할한다.

규칙(설계서 §3):
  - 장면(scene) 경계를 존중: 가능하면 scene-break 에서 자른다.
  - 파트 경계를 넘지 않는다.
  - 목표 ~2000 영어 단어, 최소 1200, 최대 3000.
  - 한 장면이 최대치를 넘으면 문단 경계에서 부득이 분할.

산출물: data/chunks/<startid>-<endid>.json
  { chunk_id, part, first, last, n_segments, words, segments:[...원본 segment...] }
청크 파일에는 원본 segment 를 그대로 담는다(번역은 별도 translations/ 에 저장).
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEG = ROOT / "data" / "segments.jsonl"
OUTDIR = ROOT / "data" / "chunks"

TARGET = 2000
MIN_W = 1200
MAX_W = 3000


def wc(text):
    return len(re.findall(r"\S+", text))


def main():
    segs = [json.loads(l) for l in SEG.open(encoding="utf-8")]
    for f in OUTDIR.glob("*.json"):
        f.unlink()

    chunks = []
    cur = []
    cur_words = 0
    cur_part = None

    def flush():
        nonlocal cur, cur_words
        if not cur:
            return
        chunks.append(cur)
        cur = []
        cur_words = 0

    for s in segs:
        # 파트가 바뀌면 무조건 새 청크
        if cur and s["part"] != cur_part:
            flush()
        if not cur:
            cur_part = s["part"]
        cur.append(s)
        cur_words += wc(s["text"])
        at_break = s["kind"] == "scene-break"
        # 장면 경계에서 충분히 크면 자른다
        if at_break and cur_words >= MIN_W:
            flush()
        # 장면이 너무 길면 문단 경계에서 강제 분할
        elif cur_words >= MAX_W and not at_break:
            flush()

    flush()

    # 마지막 청크가 너무 작으면 직전 청크에 병합(같은 파트일 때만)
    merged = []
    for ch in chunks:
        w = sum(wc(s["text"]) for s in ch)
        if (
            merged
            and w < MIN_W // 2
            and merged[-1][0]["part"] == ch[0]["part"]
        ):
            merged[-1].extend(ch)
        else:
            merged.append(ch)
    chunks = merged

    OUTDIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for ch in chunks:
        first, last = ch[0]["id"], ch[-1]["id"]
        words = sum(wc(s["text"]) for s in ch)
        parts = sorted({s["part"] for s in ch})
        rec = {
            "chunk_id": f"{first}-{last}",
            "part": parts[0] if len(parts) == 1 else parts,
            "first": first,
            "last": last,
            "n_segments": len(ch),
            "words": words,
            "segments": ch,
        }
        (OUTDIR / f"{first}-{last}.json").write_text(
            json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        manifest.append(
            {k: rec[k] for k in ("chunk_id", "part", "n_segments", "words")}
        )

    (ROOT / "data" / "chunks_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    ws = [m["words"] for m in manifest]
    print("chunks:", len(manifest))
    print("words/chunk: min %d  max %d  avg %d" % (min(ws), max(ws), sum(ws) // len(ws)))
    print("total words:", sum(ws))
    spanning = [m for m in manifest if not isinstance(m["part"], str)]
    print("part-spanning chunks (should be 0):", len(spanning))


if __name__ == "__main__":
    main()
