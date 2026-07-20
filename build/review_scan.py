#!/usr/bin/env python3
"""
review_scan.py — 감수 결과(data/translations)에서 마커/파싱 이상을 일괄 탐지한다.

감수(review_chunk.py)의 마커 왕복 과정에서 드물게 생기는 손상을 사후에 잡기 위한 무료 감사 도구.
data/review_backup 이 있으면 감수 전과 대조해 과압축(내용 드롭)도 본다.

검사:
  1) 코드 접두어 누출: run 텍스트에 "e:", "ti:" 같은 용도 코드가 남음(이탤릭이 사라진 흔적).
  2) 미분류 이탤릭: i:true (감수 후에는 없어야 함).
  3) 잔여 마커: 본문(문단) 번역에 '*' 가 남음(scene-break 제외).
  4) 과압축(백업 대비): 새 번역이 원래의 80% 미만 길이(문장/대사 드롭 의심).

사용: python3 build/review_scan.py   (이상 있으면 목록 출력, 종료코드 1)
"""
import json
import glob
import os
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LEAK = re.compile(r"(?:^|[\s\"'(가-힣])(ti|[tefco]):(?=[가-힣])")


def load(path):
    return {json.loads(l)["id"]: json.loads(l)
            for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()}


def plain(o):
    return "".join(r["t"] for r in o["runs"])


def main():
    segs = load(DATA / "segments.jsonl")
    leaks, unresolved, stray, condensed, inserted = [], [], [], [], []
    for f in sorted(glob.glob(str(DATA / "translations" / "*.jsonl"))):
        cid = os.path.basename(f)[:-6]
        cur = load(f)
        bak = load(DATA / "review_backup" / f"{cid}.jsonl") if (DATA / "review_backup" / f"{cid}.jsonl").exists() else {}
        for sid, o in cur.items():
            is_scene = segs.get(sid, {}).get("kind") == "scene-break"
            for r in o["runs"]:
                if LEAK.search(r["t"]):
                    leaks.append((sid, cid, r["t"][:50]))
                if r.get("i") is True:
                    unresolved.append((sid, cid))
                if not is_scene and "*" in r["t"]:
                    stray.append((sid, cid, r["t"][:50]))
            if sid in bak:
                ot, nt = plain(bak[sid]), plain(o)
                if ot != nt and len(nt) < 0.80 * len(ot):
                    condensed.append((sid, cid, len(ot), len(nt)))
                # 순수 삽입(대응 삭제 없는 연속 추가) — 환각(원문에 없는 문장 지어내기) 신호.
                # rephrase(replace)는 제외, 6자 이상 'insert' 만.
                if ot != nt:
                    for tag, i1, i2, j1, j2 in SequenceMatcher(None, ot, nt, autojunk=False).get_opcodes():
                        if tag == "insert" and (j2 - j1) >= 6:
                            inserted.append((sid, cid, nt[j1:j2][:40]))

    def show(title, items, fmt):
        print(f"\n■ {title}: {len(items)}건")
        for it in items:
            print("   " + fmt(it))

    show("코드 접두어 누출", leaks, lambda t: f"{t[0]} [{t[1]}]: {t[2]}")
    show("미분류 이탤릭(i:true)", unresolved, lambda t: f"{t[0]} [{t[1]}]")
    show("잔여 마커(*)", stray, lambda t: f"{t[0]} [{t[1]}]: {t[2]}")
    show("과압축(백업 대비 <80%)", condensed, lambda t: f"{t[0]} [{t[1]}]: {t[2]}자→{t[3]}자")
    show("순수 삽입(환각 의심, ≥6자)", inserted, lambda t: f"{t[0]} [{t[1]}]: +「{t[2]}」")

    total = len(leaks) + len(unresolved) + len(stray) + len(condensed) + len(inserted)
    print(f"\n총 이상 {total}건")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
