#!/usr/bin/env python3
"""
extract.py — Blindsight 원본 HTML을 구조화된 segment 데이터로 추출한다.

산출물:
  data/segments.jsonl   각 줄 = 본문 1 segment (불변 id, kind, align, part, scene, text, runs)
  data/watts_notes.json 와츠 '주석과 참고문헌' 부록의 각주 원문 (번역 칸은 비워둠)

번역/표현을 건드리지 않는 1회성 추출. id는 등장 순서 기반 s0001.. 으로 부여한다.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "Blindsight.html"
OUT_SEG = ROOT / "data" / "segments.jsonl"
OUT_NOTES = ROOT / "data" / "watts_notes.json"

# 본문(스토리) 파트 — 이 앵커들 사이가 소설 본문. Acknowledgments 부터는 본문 아님.
STORY_PARTS = ["Prologue", "Theseus", "Rorschach", "Charybdis"]
STOP_ANCHOR = "Acknowledgments"


def get_align(style):
    if not style:
        return "justify"
    s = style.lower()
    if "text-align:right" in s or "text-align: right" in s:
        return "right"
    if "text-align:center" in s or "text-align: center" in s:
        return "center"
    return "justify"


def collect_runs(el):
    """문단 내부를 순회해 runs([{t, i?}]) 와 참조된 와츠 각주 번호 목록을 만든다."""
    runs = []
    notes = []

    def push(text, italic):
        if text == "":
            return
        if runs and runs[-1].get("i", False) == italic:
            runs[-1]["t"] += text
        else:
            r = {"t": text}
            if italic:
                r["i"] = True
            runs.append(r)

    def walk(node, italic):
        for child in node.children:
            if isinstance(child, NavigableString):
                txt = str(child).replace("\r", " ").replace("\n", " ")
                push(txt, italic)
            elif isinstance(child, Tag):
                if child.name == "br":
                    push("\n", italic)
                    continue
                cls = " ".join(child.get("class") or [])
                if child.name == "a" and "sdfootnoteanc" in cls:
                    m = re.search(r"sdfootnote(\d+)anc", child.get("name", ""))
                    if m:
                        notes.append(int(m.group(1)))
                    continue  # 각주 참조 마커는 본문 텍스트에서 제외
                child_italic = italic or child.name in ("i", "em")
                st = (child.get("style") or "").lower()
                if "font-style:italic" in st or "font-style: italic" in st:
                    child_italic = True
                if "font-style:normal" in st or "font-style: normal" in st:
                    child_italic = False
                walk(child, child_italic)

    walk(el, False)
    for r in runs:
        r["t"] = re.sub(r"[ \t]+", " ", r["t"])
    if runs:
        runs[0]["t"] = runs[0]["t"].lstrip()
        runs[-1]["t"] = runs[-1]["t"].rstrip()
    runs = [r for r in runs if r["t"] != ""]
    text = "".join(r["t"] for r in runs)
    seen = set()
    notes_u = []
    for n in notes:
        if n not in seen:
            seen.add(n)
            notes_u.append(n)
    return runs, text, notes_u


def classify(text):
    stripped = text.strip()
    if stripped == "":
        return None
    if re.fullmatch(r"[\*·\s]+", stripped) and "*" in stripped:
        return "scene-break"
    return "para"


def main():
    html = SRC.read_bytes().decode("windows-1252", "replace")
    soup = BeautifulSoup(html, "lxml")

    anchors = {}
    for a in soup.find_all("a"):
        nm = a.get("name")
        if nm in STORY_PARTS or nm == STOP_ANCHOR:
            anchors[nm] = a
    if "Prologue" not in anchors or STOP_ANCHOR not in anchors:
        print("ERROR: 본문 경계 앵커를 찾지 못함", file=sys.stderr)
        sys.exit(1)

    all_nodes = list(soup.descendants)
    # 주의: bs4 Tag.__eq__ 는 내용 기반 비교라 list.index() 가 동일 내용('*' 장면구분 등)을
    # 첫 등장 위치로 잘못 잡는다. 반드시 객체 식별자(id) 기반 위치 맵을 쓴다.
    pos_of = {id(n): i for i, n in enumerate(all_nodes)}
    start_i = pos_of[id(anchors["Prologue"])]
    stop_i = pos_of[id(anchors[STOP_ANCHOR])]

    part_marks = sorted(
        (pos_of[id(anchors[p])], p) for p in STORY_PARTS if p in anchors
    )

    def part_at(pos):
        cur = None
        for apos, pname in part_marks:
            if apos <= pos:
                cur = pname
            else:
                break
        return cur

    segments = []
    sid = 0
    scene = 1
    prev_part = None
    for el in soup.find_all("p"):
        pos = pos_of[id(el)]
        if pos < start_i or pos >= stop_i:
            continue
        current_part = part_at(pos)
        if current_part != prev_part:  # 파트가 실제로 바뀔 때만 장면 리셋
            scene = 1
            prev_part = current_part
        runs, text, notes = collect_runs(el)
        kind = classify(text)
        if kind is None:
            continue
        if kind == "scene-break":
            scene += 1
        sid += 1
        seg = {
            "id": "s%04d" % sid,
            "kind": kind,
            "align": get_align(el.get("style", "")),
            "part": current_part,
            "scene": scene,
            "text": text,
            "runs": runs,
        }
        if notes:
            seg["watts_notes"] = ["sdfootnote%d" % n for n in notes]
        segments.append(seg)

    with OUT_SEG.open("w", encoding="utf-8") as f:
        for seg in segments:
            f.write(json.dumps(seg, ensure_ascii=False) + "\n")

    # --- 와츠 '주석과 참고문헌' 부록의 각주 정의 추출 ---
    notes_out = {}
    notes_anchor = None
    for a in soup.find_all("a"):
        if a.get("name") == "Notes":
            notes_anchor = a
            break
    if notes_anchor is not None:
        npos = pos_of[id(notes_anchor)]
        for el in soup.find_all("p"):
            if pos_of[id(el)] <= npos:
                continue
            a = el.find("a", attrs={"name": re.compile(r"sdfootnote\d+sym")})
            if not a:
                continue
            m = re.search(r"sdfootnote(\d+)sym", a.get("name"))
            if not m:
                continue
            n = int(m.group(1))
            txt = el.get_text(" ", strip=True)
            txt = re.sub(r"^\s*\d+\s*", "", txt)
            notes_out["sdfootnote%d" % n] = {"en": txt, "ko": ""}

    OUT_NOTES.write_text(
        json.dumps(notes_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    kinds = Counter(s["kind"] for s in segments)
    aligns = Counter(s["align"] for s in segments)
    parts = Counter(s["part"] for s in segments)
    print("segments:", len(segments))
    print("kinds:", dict(kinds))
    print("aligns:", dict(aligns))
    print("parts:", dict(parts))
    print("watts_notes:", len(notes_out))


if __name__ == "__main__":
    main()
