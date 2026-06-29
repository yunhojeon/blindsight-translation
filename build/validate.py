#!/usr/bin/env python3
"""
validate.py [chunk_id ...] — 번역 산출물을 일괄 검증한다(설계서 §10 검증).

검사:
  1) id 정합성: 번역 id 집합/순서가 청크 segment 와 일치
  2) 상태: 모두 translated
  3) 이탤릭 보존: 원문에 강조가 있는데 번역에 하나도 없으면 경고
  4) 장면 구분: scene-break 는 runs 보존
  5) 확정 용어: 원문에 locked 영어 용어가 있으면 번역에 해당 ko 가 있는지(경고)
  6) 말투: 대화 segment 의 speaker->addressee 가 매트릭스와 어긋나면 경고
인자 없으면 translations/ 의 모든 청크 검사.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TR = DATA / "translations"

segs = {json.loads(l)["id"]: json.loads(l)
        for l in (DATA / "segments.jsonl").read_text(encoding="utf-8").splitlines()}
gl = json.loads((DATA / "glossary.json").read_text(encoding="utf-8"))
locked = {en: e["ko"] for en, e in gl.items() if e.get("locked")}
aliases = {}
for en, e in gl.items():
    if e.get("locked"):
        ko = e["ko"]
        # proper(인명·함선)은 한글 성/이름 토큰만 써도 정답(아이작 스핀델 -> 스핀델)
        toks = [ko] + (ko.split() if e.get("type") == "proper" else [])
        for a in [en] + e.get("aliases", []):
            aliases[a] = toks
matrix = json.loads((DATA / "characters.json").read_text(encoding="utf-8"))["register_matrix"]


def chunk_ids(cid):
    return [s["id"] for s in json.loads((DATA / "chunks" / f"{cid}.json").read_text(encoding="utf-8"))["segments"]]


def main():
    cids = sys.argv[1:] or [p.stem for p in sorted(TR.glob("*.jsonl"))]
    total_warn = 0
    for cid in cids:
        warns = []
        want = chunk_ids(cid)
        tr = [json.loads(l) for l in (TR / f"{cid}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
        got = [t["id"] for t in tr]
        if got != want:
            warns.append(f"id 순서/집합 불일치: missing={set(want)-set(got)} extra={set(got)-set(want)}")
        tmap = {t["id"]: t for t in tr}
        for sid in want:
            t = tmap.get(sid)
            src = segs[sid]
            if not t:
                continue
            if t.get("status") != "translated":
                warns.append(f"{sid}: status={t.get('status')}")
            # 이탤릭 보존
            src_it = sum(1 for r in src["runs"] if r.get("i"))
            tr_it = sum(1 for r in t.get("runs", []) if r.get("i"))
            if src_it and not tr_it:
                warns.append(f"{sid}: 원문 이탤릭 {src_it}개인데 번역 강조 0")
            # 장면 구분
            if src["kind"] == "scene-break":
                txt = "".join(r["t"] for r in t.get("runs", []))
                if "*" not in txt:
                    warns.append(f"{sid}: scene-break runs 손실")
            # 확정 용어 (단어 경계 기반; 약어 substring 오탐 방지)
            text = src["text"]
            ko_all = "".join(r["t"] for r in t.get("runs", []))
            for a, toks in aliases.items():
                if re.fullmatch(r"[A-Za-z][A-Za-z' \-]*", a):
                    # 전부 대문자인 짧은 약어(TAT 등)는 대소문자 구분 — 'tit-for-tat'의 'tat' 같은 오탐 방지
                    flags = 0 if (a.isupper() and len(a) <= 5) else re.I
                    hit = re.search(r"\b" + re.escape(a) + r"\b", text, flags)
                else:
                    hit = a.lower() in text.lower()
                if hit and not any(tk in ko_all for tk in toks):
                    warns.append(f"{sid}: 원문에 '{a}' 있으나 번역에 ko('{toks[0]}') 없음")
                    break
            # 말투
            sp, ad, reg = t.get("speaker"), t.get("addressee"), t.get("register")
            if sp and ad:
                key = f"{sp}->{ad}"
                exp = matrix.get(key, {}).get("register")
                if exp and reg and exp != reg:
                    warns.append(f"{sid}: 말투 {reg} != 매트릭스 {exp} ({key})")
        status = "OK" if not warns else f"{len(warns)} WARN"
        print(f"[{cid}] {len(want)} segs — {status}")
        for w in warns:
            print("   -", w)
        total_warn += len(warns)
    print(f"\n총 경고: {total_warn}")


if __name__ == "__main__":
    main()
