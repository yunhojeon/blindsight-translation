#!/usr/bin/env python3
"""
build_reader.py — 번역 데이터(translations/)를 단일 HTML 리더로 빌드한다.

표현 규칙(설계서 §6/§7/§11):
  - 이탤릭(run.i) -> 목적별 span.ital.i-<kind> (kind 없으면 i-default)
  - glossary first_mark -> 첫 등장 시 한글(English[, 漢字]) 자동 병기 (data-anno 로 표시)
  - coinage -> 첫 등장 시 고유명사색 span.coinage
  - 문단별 인라인 원문 토글(평소 숨김), 전역 토글(원문/주석)
  - 정렬(right/center) 보존, scene-break 구분선

HTML/CSS/JS 는 build/templates/ 의 reader.html · reader.css · reader.js 에 있다.
표현(색·레이아웃·이탤릭 스타일)을 바꾸려면 그 파일들을 직접 편집하고 다시 빌드하면 된다.
번역 데이터는 일절 수정하지 않는다.
사용: python3 build/build_reader.py [chunk_id ...]   (없으면 번역된 청크 전부)
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TR = DATA / "translations"
TPL = ROOT / "build" / "templates"
OUT = ROOT / "dist" / "preview.html"

# ── 이탤릭 목적 분류 ────────────────────────────────────────────────────
# run.i 값 → CSS 클래스. i:true(불리언)는 미분류 → i-default.
# 문자열이면 정규화(별칭 흡수) 후 i-<kind>. 알 수 없는 종류도 그대로 통과시켜
# reader.css 에 새 .i-<kind> 만 추가하면 동작하도록 한다.
ITALIC_ALIASES = {
    "monologue": "thought", "inner": "thought", "flashback": "thought",
    "emph": "emphasis", "stress": "emphasis",
    "alien": "foreign", "invented": "foreign", "neologism": "foreign", "term": "foreign",
    "ship": "title", "vessel": "title", "book": "title", "work": "title", "name": "title",
    "radio": "comm", "comms": "comm", "communication": "comm", "transmission": "comm",
}


def italic_class(i):
    """run.i 값을 'ital i-<kind>' 클래스 문자열로."""
    if i is True:
        kind = "default"
    else:
        kind = str(i).strip().lower()
        kind = ITALIC_ALIASES.get(kind, kind)
        kind = re.sub(r"[^a-z0-9-]", "", kind) or "default"
    return f"ital i-{kind}"

segs = {json.loads(l)["id"]: json.loads(l)
        for l in (DATA / "segments.jsonl").read_text(encoding="utf-8").splitlines()}
gl = json.loads((DATA / "glossary.json").read_text(encoding="utf-8"))
manifest = json.loads((DATA / "chunks_manifest.json").read_text(encoding="utf-8"))
order = [m["chunk_id"] for m in manifest]


def esc(s):
    return html.escape(s).replace("\n", "<br>")


def render_runs(runs):
    out = []
    for r in runs:
        t = esc(r["t"])
        iv = r.get("i")
        out.append(f'<span class="{italic_class(iv)}">{t}</span>' if iv else t)
    return "".join(out)


# first_mark/coinage 적용 대상: ko 가 있고 first_mark 또는 coinage 인 항목
marks = []
for en, e in gl.items():
    if not e.get("ko"):
        continue
    fm, coin = e.get("first_mark"), e.get("coinage")
    if fm or coin:
        anno = ""
        if fm:
            bits = []
            if fm.get("hanja"):
                bits.append(fm["hanja"])
            if fm.get("en"):
                bits.append(en)
            if bits:
                anno = f'<span class="anno" data-anno>({", ".join(html.escape(b) for b in bits)})</span>'
            if fm.get("title_link"):
                anno += '<span class="anno" data-anno title="이 작품의 제목 · 국내 통용 \'블라인드사이트\'">ⓘ</span>'
        marks.append({"ko": e["ko"], "anno": anno, "coin": bool(coin), "done": False})
# 긴 ko 부터 처리(부분문자열 충돌 방지)
marks.sort(key=lambda m: len(m["ko"]), reverse=True)


def apply_marks(html_str, ko_text):
    """이 segment 의 렌더 HTML 에 첫 등장 병기/coinage 를 1회씩 적용."""
    for m in marks:
        if m["done"] or m["ko"] not in ko_text:
            continue
        # 렌더 HTML 에서 ko 의 첫 등장을 찾아 치환(태그 경계는 단순 가정)
        idx = html_str.find(m["ko"])
        if idx == -1:
            continue
        term = m["ko"]
        rep = f'<span class="coinage">{term}</span>' if m["coin"] else term
        rep += m["anno"]
        html_str = html_str[:idx] + rep + html_str[idx + len(term):]
        m["done"] = True
    return html_str


def seg_html(tr):
    src = segs[tr["id"]]
    if src["kind"] == "scene-break":
        return '<hr class="scene">'
    ko_runs = tr.get("runs", [])
    ko_text = "".join(r["t"] for r in ko_runs)
    body = apply_marks(render_runs(ko_runs), ko_text)
    cls = {"right": "ta-right", "center": "ta-center"}.get(src["align"], "")
    orig = esc(src["text"])
    return (
        f'<p class="seg {cls}" id="{tr["id"]}" data-id="{tr["id"]}">'
        f'<span class="ko">{body}</span>'
        f'<button class="orig-toggle" title="원문 보기" aria-label="원문">›</button>'
        f'<span class="orig" hidden>{orig}</span></p>'
    )


def build_body(cids):
    parts = []
    for cid in cids:
        f = TR / f"{cid}.jsonl"
        if not f.exists():
            continue
        trs = [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
        parts.append(f'<section data-chunk="{cid}">')
        for tr in trs:
            parts.append(seg_html(tr))
        parts.append('</section>')
    return "\n".join(parts)


def main():
    cids = sys.argv[1:] or [c for c in order if (TR / f"{c}.jsonl").exists()]
    cids = [c for c in cids if (TR / f"{c}.jsonl").exists()]

    template = (TPL / "reader.html").read_text(encoding="utf-8")
    styles = (TPL / "reader.css").read_text(encoding="utf-8")
    script = (TPL / "reader.js").read_text(encoding="utf-8")

    body = build_body(cids)
    built_info = f"{len(cids)}개 청크"
    out_html = (template
                .replace("{{STYLES}}", styles)
                .replace("{{SCRIPT}}", script)
                .replace("{{BUILT_INFO}}", built_info)
                .replace("{{BODY}}", body))  # BODY 마지막: 본문에 {{...}} 가 있어도 안전
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out_html, encoding="utf-8")
    print("built", OUT, "| chunks:", len(cids))


if __name__ == "__main__":
    main()
