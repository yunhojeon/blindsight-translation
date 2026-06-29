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


def _build_anno(en, e):
    fm = e.get("first_mark")
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
    return anno


# first_mark/coinage 적용 대상: ko 가 있고 first_mark 또는 coinage 인 항목.
# 같은 ko 가 여러 en 에 걸리면(예: vampire/Vampire, inlays/inlay) 1개만 병기(중복 방지).
# locked 항목을 우선 채택.
_by_ko = {}
for en, e in gl.items():
    if not e.get("ko") or not (e.get("first_mark") or e.get("coinage")):
        continue
    ko = e["ko"]
    prev = _by_ko.get(ko)
    if prev is None or (e.get("locked") and not prev[1]):
        _by_ko[ko] = ({"ko": ko, "anno": _build_anno(en, e),
                       "coin": bool(e.get("coinage")), "done": False}, bool(e.get("locked")))
marks = [v[0] for v in _by_ko.values()]
# 긴 ko 부터(짧은 ko 가 긴 ko 안에 잘못 박히는 것 방지: '벤'⊂'빅 벤' 등)
marks.sort(key=lambda m: len(m["ko"]), reverse=True)


def _in_tag(s, idx):
    """idx 위치가 HTML 태그(<...>) 내부이면 True(병기 삽입 금지)."""
    return s.rfind("<", 0, idx) > s.rfind(">", 0, idx)


def apply_marks(html_str, ko_text):
    """이 segment 의 렌더 HTML 에 첫 등장 병기/coinage 를 1회씩 적용.
    겹침·태그 내부를 피하고, 같은 ko 는 marks 단계에서 이미 1개로 합쳐져 중복되지 않는다."""
    claimed = []   # 이번 segment 에서 이미 병기한 (start,end) 구간(원본 html_str 좌표)
    placements = []
    for m in marks:
        if m["done"] or m["ko"] not in ko_text:
            continue
        term = m["ko"]
        start = 0
        while True:
            idx = html_str.find(term, start)
            if idx == -1:
                break
            end = idx + len(term)
            overlap = any(not (end <= cs or idx >= ce) for cs, ce in claimed)
            if overlap or _in_tag(html_str, idx):
                start = idx + 1
                continue
            rep = (f'<span class="coinage">{term}</span>' if m["coin"] else term) + m["anno"]
            placements.append((idx, end, rep))
            claimed.append((idx, end))
            m["done"] = True
            break
    # 오른쪽부터 적용(앞쪽 인덱스 보존)
    for s, e, rep in sorted(placements, reverse=True):
        html_str = html_str[:s] + rep + html_str[e:]
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
        f'<button class="seg-handle" aria-label="문단 도구" tabindex="-1">⋮</button>'
        f'<span class="ko">{body}</span>'
        f'<span class="orig">{orig}</span></p>'
    )


def build_body(cids):
    parts, snips = [], {}
    for cid in cids:
        f = TR / f"{cid}.jsonl"
        if not f.exists():
            continue
        trs = [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
        parts.append(f'<section data-chunk="{cid}">')
        for tr in trs:
            parts.append(seg_html(tr))
            if segs[tr["id"]]["kind"] != "scene-break":
                snips[tr["id"]] = "".join(r["t"] for r in tr.get("runs", [])).strip()
        parts.append('</section>')
    return "\n".join(parts), snips


def build_toc(snips):
    """파트(헤더) + 장면(첫 문장 스니펫) 목차. 앵커는 실제 문단 id(scene-break 제외)."""
    items = []
    cur_part = cur_scene = None
    scene_no = 0
    for sid, s in segs.items():
        if s["kind"] == "scene-break" or sid not in snips:
            continue
        part, scene = s.get("part"), s.get("scene")
        if part != cur_part:
            cur_part, cur_scene, scene_no = part, scene, 1
            items.append(f'<li class="toc-part"><a href="#{sid}">{html.escape(str(part))}</a></li>')
        elif scene != cur_scene:
            cur_scene = scene
            scene_no += 1
            snip = html.escape(snips.get(sid, "")[:24])
            items.append(f'<li class="toc-scene"><a href="#{sid}">'
                         f'<span class="toc-n">{scene_no}</span>{snip}…</a></li>')
    return "\n".join(items)


def main():
    cids = sys.argv[1:] or [c for c in order if (TR / f"{c}.jsonl").exists()]
    cids = [c for c in cids if (TR / f"{c}.jsonl").exists()]

    template = (TPL / "reader.html").read_text(encoding="utf-8")
    styles = (TPL / "reader.css").read_text(encoding="utf-8")
    script = (TPL / "reader.js").read_text(encoding="utf-8")

    body, snips = build_body(cids)
    toc = build_toc(snips)
    built_info = f"{len(cids)}개 청크"
    # CSS/JS 는 HTML 주석 마커로 인라인(에디터 포매터가 <style>{{..}}</style> 를 깨뜨리는 것 방지)
    out_html = (template
                .replace("<!--{{STYLES}}-->", f"<style>\n{styles}\n</style>")
                .replace("<!--{{SCRIPT}}-->", f"<script>\n{script}\n</script>")
                .replace("{{BUILT_INFO}}", built_info)
                .replace("{{TOTAL}}", str(len(segs)))
                .replace("{{TOC}}", toc)
                .replace("{{BODY}}", body))  # BODY 마지막: 본문에 {{...}} 가 있어도 안전
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out_html, encoding="utf-8")
    print("built", OUT, "| chunks:", len(cids))


if __name__ == "__main__":
    main()
