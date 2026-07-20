#!/usr/bin/env python3
"""
review_diff.py — 감수로 바뀐 세그먼트를 (원문 EN / 기존 번역 / 새 번역) 대조표로 만든다.

data/review_backup/<cid>.jsonl(감수 전) 과 data/translations/<cid>.jsonl(감수 후)를
세그먼트 id 로 비교해, 달라진 것만 review_diff.html 로 출력한다.
 - 텍스트 변경: 바뀐 글자 범위를 배경색으로 강조(difflib).
 - 이탤릭 재분류만(텍스트 동일): 어구별 용도 코드 변화만 표기.
 - 이탤릭 run 은 용도별 색으로 렌더.

사용: python3 build/review_diff.py  (→ review_diff.html)
"""
import html
import json
import glob
import os
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "review_diff.html"

KIND_LBL = {"thought": "생각", "emphasis": "강조", "foreign": "외국어",
            "title": "이름", "comm": "통신", "other": "기타"}


def load(path):
    d = {}
    for l in Path(path).read_text(encoding="utf-8").splitlines():
        if l.strip():
            o = json.loads(l)
            d[o["id"]] = o
    return d


def plain(runs):
    return "".join(r["t"] for r in runs)


def char_kinds(runs):
    """각 글자의 이탤릭 용도(없으면 None) 배열."""
    ks = []
    for r in runs:
        k = r.get("i")
        k = (None if not k else (k if isinstance(k, str) else "emphasis"))
        ks.extend([k] * len(r["t"]))
    return ks


def render(runs, changed_mask=None):
    """runs 를 HTML 로. changed_mask[i]=True 인 글자는 <mark> 로 강조. 이탤릭은 <i class=i-kind>."""
    text = plain(runs)
    kinds = char_kinds(runs)
    if changed_mask is None:
        changed_mask = [False] * len(text)
    out = []
    cur_k, cur_m = "\0", False
    open_i = open_m = False
    for ch, k, m in zip(text, kinds, changed_mask):
        if m != cur_m:
            if open_m:
                out.append("</mark>")
                open_m = False
            if m:
                out.append('<mark>')
                open_m = True
            cur_m = m
        if k != cur_k:
            if open_i:
                out.append("</i>")
                open_i = False
            if k:
                out.append(f'<i class="i-{k}" title="{KIND_LBL.get(k, k)}">')
                open_i = True
            cur_k = k
        out.append(html.escape(ch))
    if open_i:
        out.append("</i>")
    if open_m:
        out.append("</mark>")
    return "".join(out)


def render_en(runs):
    out = []
    for r in runs:
        t = html.escape(r["t"])
        out.append(f"<i>{t}</i>" if r.get("i") else t)
    return "".join(out)


def diff_masks(a, b):
    """a(기존)·b(새) 평문에서 바뀐 글자 마스크(삭제용 a-mask, 삽입용 b-mask)."""
    sm = SequenceMatcher(None, a, b, autojunk=False)
    ma = [False] * len(a)
    mb = [False] * len(b)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            for i in range(i1, i2):
                ma[i] = True
            for j in range(j1, j2):
                mb[j] = True
    return ma, mb


def italic_changes(seg, old, new):
    """텍스트 동일 시, 어구별 용도 변화 목록."""
    changes = []
    o = {r["t"]: (r.get("i") if isinstance(r.get("i"), str) else "emphasis")
         for r in old["runs"] if r.get("i")}
    n = {r["t"]: (r.get("i") if isinstance(r.get("i"), str) else "emphasis")
         for r in new["runs"] if r.get("i")}
    for t in set(o) | set(n):
        ov, nv = o.get(t), n.get(t)
        if ov != nv:
            changes.append((t, ov, nv))
    return changes


def main():
    segs = load(DATA / "segments.jsonl")
    entries = []
    for bp in sorted(glob.glob(str(DATA / "review_backup" / "*.jsonl"))):
        cid = os.path.basename(bp)[:-6]
        old = load(bp)
        new = load(DATA / "translations" / f"{cid}.jsonl")
        for sid in old:
            if sid not in new or old[sid] == new[sid]:
                continue
            oa, nb = plain(old[sid]["runs"]), plain(new[sid]["runs"])
            entries.append((sid, cid, oa != nb))
    entries.sort(key=lambda e: int(e[0][1:]))
    n_text = sum(1 for _, _, t in entries if t)
    n_ital = len(entries) - n_text

    rows = []
    for sid, cid, is_text in entries:
        old = load(DATA / "review_backup" / f"{cid}.jsonl")[sid]
        new = load(DATA / "translations" / f"{cid}.jsonl")[sid]
        en = render_en(segs[sid]["runs"]) if sid in segs else "(원문 없음)"
        badge = "텍스트" if is_text else "이탤릭"
        bcls = "b-text" if is_text else "b-ital"
        if is_text:
            oa, nb = plain(old["runs"]), plain(new["runs"])
            ma, mb = diff_masks(oa, nb)
            old_html = render(old["runs"], ma)
            new_html = render(new["runs"], mb)
            extra = ""
        else:
            old_html = render(old["runs"])
            new_html = render(new["runs"])
            ic = italic_changes(sid, old, new)
            bits = [f'「{html.escape(t)}」 {KIND_LBL.get(o, o) if o else "—"}→'
                    f'{KIND_LBL.get(nn, nn) if nn else "—"}' for t, o, nn in ic]
            extra = ('<div class="ital-note">이탤릭 용도: ' + " · ".join(bits) + "</div>") if bits else ""
        rows.append(f'''<div class="seg" id="{sid}">
  <div class="hd"><span class="id">{sid}</span><span class="badge {bcls}">{badge}</span><span class="cid">{cid}</span></div>
  <div class="en">{en}</div>
  <div class="ko old"><span class="tag">기존</span>{old_html}</div>
  <div class="ko new"><span class="tag">새</span>{new_html}</div>
  {extra}
</div>''')

    doc = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blindsight 감수 대조 ({len(entries)}건)</title>
<style>
:root{{--bg:#faf8f4;--ink:#23211d;--muted:#8a8478;--rule:#e6e0d6;--en:#6b7a86;
--del:#f7d4d4;--ins:#cdeccd;--card:#fff;
--thought:#8c877e;--emphasis:#b4541a;--foreign:#2c6e63;--title:#2f6f6a;--comm:#2c4a63;--other:#7a6a55;}}
@media(prefers-color-scheme:dark){{:root{{--bg:#1a1916;--ink:#e8e3d8;--muted:#8a8478;--rule:#322e28;--en:#8fa1ad;
--del:#4a2a2a;--ins:#294a29;--card:#232019;
--thought:#8f8a80;--emphasis:#e58a4e;--foreign:#79c2bb;--title:#79c2bb;--comm:#bcd4e6;--other:#c2a878;}}}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:"Noto Serif KR",serif;line-height:1.7;
font-size:16px;padding:0 0 60px}}
header{{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--rule);
padding:14px 18px;z-index:5}}
h1{{font-size:16px;margin:0;font-family:"Noto Sans KR",sans-serif}}
.sub{{color:var(--muted);font-size:13px;margin-top:3px;font-family:"Noto Sans KR",sans-serif}}
.wrap{{max-width:820px;margin:0 auto;padding:18px}}
.seg{{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:14px 16px;margin:0 0 14px}}
.hd{{display:flex;gap:8px;align-items:center;margin-bottom:8px;font-family:"Noto Sans KR",sans-serif}}
.id{{font-weight:700;font-size:13px}}
.cid{{color:var(--muted);font-size:11px;margin-left:auto}}
.badge{{font-size:11px;padding:1px 7px;border-radius:10px}}
.b-text{{background:color-mix(in srgb,var(--emphasis) 20%,transparent);color:var(--emphasis)}}
.b-ital{{background:color-mix(in srgb,var(--title) 20%,transparent);color:var(--title)}}
.en{{color:var(--en);font-size:14px;font-style:italic;margin-bottom:10px;font-family:Georgia,serif}}
.ko{{position:relative;padding-left:42px;margin:5px 0}}
.tag{{position:absolute;left:0;top:2px;font-size:11px;color:var(--muted);font-family:"Noto Sans KR",sans-serif}}
.old{{color:var(--muted)}}
.new{{}}
mark{{background:var(--ins);color:inherit;border-radius:2px;padding:0 1px}}
.old mark{{background:var(--del)}}
i{{font-style:italic}}
.i-thought{{color:var(--thought)}} .i-emphasis{{color:var(--emphasis);font-style:normal;font-weight:600}}
.i-foreign{{color:var(--foreign);font-style:normal}} .i-title{{color:var(--title)}}
.i-comm{{color:var(--comm);font-style:normal}} .i-other{{color:var(--other)}}
.ital-note{{margin-top:8px;font-size:12px;color:var(--muted);font-family:"Noto Sans KR",sans-serif;
border-top:1px dashed var(--rule);padding-top:6px}}
</style></head><body>
<header><h1>Blindsight 감수 대조표</h1>
<div class="sub">총 {len(entries)}건 · 텍스트 변경 {n_text} · 이탤릭 재분류 {n_ital} —
<span style="background:var(--ins);padding:0 3px;border-radius:2px">추가/변경</span> ·
<span style="background:var(--del);padding:0 3px;border-radius:2px">삭제/기존</span></div></header>
<div class="wrap">
{"".join(rows)}
</div></body></html>'''
    OUT.write_text(doc, encoding="utf-8")
    print(f"wrote {OUT} — {len(entries)}건 (텍스트 {n_text} · 이탤릭 {n_ital})")


if __name__ == "__main__":
    main()
