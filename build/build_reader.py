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


# 직선 큰따옴표(") → 둥근 따옴표(“ ”). 데이터는 원문처럼 직선 유지, 번역 표시에서만 변환.
_OPENERS = "([{<‘“‹«—–-\n\r\t "


def _smart_quotes(text, prev):
    """직선 " 를 앞 문자 맥락으로 여는/닫는 둥근따옴표로. (변환문, 마지막 문자) 반환(run 경계 넘어 상태 유지)."""
    out = []
    for ch in text:
        if ch == '"':
            opening = prev is None or prev.isspace() or prev in _OPENERS
            ch = "“" if opening else "”"   # “ / ”
        out.append(ch)
        prev = ch
    return "".join(out), prev


def render_runs(runs):
    out = []
    prev = None
    for r in runs:
        t, prev = _smart_quotes(r["t"], prev)
        t = esc(t)
        iv = r.get("i")
        out.append(f'<span class="{italic_class(iv)}">{t}</span>' if iv else t)
    return "".join(out)


def render_orig(runs):
    """원문(영어) 렌더 — 원문의 이탤릭(run.i)을 <i> 로 반영."""
    out = []
    for r in runs:
        t = esc(r["t"])
        out.append(f"<i>{t}</i>" if r.get("i") else t)
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


# ── glossary 해설 오버레이 (영어 게이팅 → 한국어 매칭) ──────────────────
# 세그먼트 단위로 원문 영어에 표제어/별칭이 있을 때만(게이트), 그 세그먼트 번역문에서
# 한국어 ko 를 찾아 span.gl 로 감싼다. 첫 등장엔 기존 first_mark 병기(.anno)도 합쳐 붙인다.
_HANGUL = lambda c: "가" <= c <= "힣"
_LATIN_RE = re.compile(r"[A-Za-z]")
_PAREN_RE = re.compile(r"\s*\([^)]*\)")


def _has_latin(s):
    return bool(_LATIN_RE.search(s))


def _has_hangul(s):
    return any(_HANGUL(c) for c in s)


def _strip_paren(s):
    return _PAREN_RE.sub("", s).strip()


# 영어·한국어 양쪽이 흔한 단어라 의미 자동판별이 불가능 → 자동 밑줄 제외(첫 병기·용어집에만 노출)
OVERLAY_SKIP = {"창문", "기둥", "기동"}

# note 보유 항목을 ko 로 dedup(locked 우선). 같은 ko 의 영어 표면형(별칭 포함)은 합집합.
_gloss = {}
for en, e in gl.items():
    ko, note = e.get("ko"), e.get("note")
    if not ko or not note:
        continue
    aliases = e.get("aliases", [])
    en_surf = {_strip_paren(en)} | {_strip_paren(a) for a in aliases if _has_latin(a)}
    en_surf = {s for s in en_surf if s}
    ko_forms = {ko} | {a for a in aliases if _has_hangul(a)}
    locked = bool(e.get("locked"))
    cur = _gloss.get(ko)
    if cur is None:
        _gloss[ko] = {"ko": ko, "en": _strip_paren(en), "note": note,
                      "ty": e.get("type", ""), "first_seen": e.get("first_seen"),
                      "surfaces": set(en_surf), "ko_forms": set(ko_forms),
                      "coin": bool(e.get("coinage")), "anno": _build_anno(en, e),
                      "locked": locked, "first_done": False}
    else:
        cur["surfaces"] |= en_surf
        cur["ko_forms"] |= ko_forms
        cur["coin"] = cur["coin"] or bool(e.get("coinage"))
        if locked and not cur["locked"]:   # locked 항목의 en/note/병기를 우선 채택
            cur.update(en=_strip_paren(en), note=note, ty=e.get("type", ""),
                       first_seen=e.get("first_seen"), anno=_build_anno(en, e), locked=True)

gloss_list = list(_gloss.values())
for i, g in enumerate(gloss_list, 1):
    g["id"] = f"g{i}"
    g["skip_overlay"] = (g["ko"] in OVERLAY_SKIP) or (len(g["ko"]) == 1 and _has_hangul(g["ko"]))
_by_id = {g["id"]: g for g in gloss_list}


def _variants(s):
    """문장 첫머리 대문자화 대응 — 첫 글자만 대소문자 관용(나머지는 case-sensitive)."""
    return {s[0].lower() + s[1:], s[0].upper() + s[1:]} if s else set()


_surface_ids = {}
for g in gloss_list:
    for s in g["surfaces"]:
        for v in _variants(s):
            _surface_ids.setdefault(v, set()).add(g["id"])
_surf_sorted = sorted(_surface_ids, key=len, reverse=True)
GATE_RE = (re.compile(r"(?<![A-Za-z])(?:" + "|".join(re.escape(s) for s in _surf_sorted) + r")(?![A-Za-z])")
           if _surf_sorted else None)


def gate_ids(src):
    """이 세그먼트의 원문 영어에 표면형이 등장하는 glossary id 집합."""
    if not GATE_RE:
        return set()
    en_text = "".join(r["t"] for r in src.get("runs", []))
    ids = set()
    for m in GATE_RE.finditer(en_text):
        ids |= _surface_ids.get(m.group(0), set())
    return ids


# JS 로 내보낼 맵(전체 — 용어집 패널이 모든 용어를 보여주므로). span 은 data-g 로 참조.
gloss_map = {g["id"]: {"en": g["en"], "ko": g["ko"], "note": g["note"],
                       "ty": g["ty"], "fs": g["first_seen"]} for g in gloss_list}


def _in_tag(s, idx):
    """idx 위치가 HTML 태그(<...>) 내부이면 True(병기 삽입 금지)."""
    return s.rfind("<", 0, idx) > s.rfind(">", 0, idx)


def _occurrences(html_str, g):
    """이 세그먼트 렌더 HTML 에서 g 의 ko_forms 가 경계·태그 조건을 만족하는 (idx,end) 목록."""
    occ = []
    for form in sorted(g["ko_forms"], key=len, reverse=True):
        latin = _has_latin(form)
        start = 0
        while True:
            idx = html_str.find(form, start)
            if idx == -1:
                break
            start = idx + 1
            end = idx + len(form)
            if idx > 0:                                   # 좌측 경계
                pc = html_str[idx - 1]
                if _HANGUL(pc) or (latin and pc.isalnum()):
                    continue
            if latin and end < len(html_str) and html_str[end].isalnum():
                continue
            if _in_tag(html_str, idx):
                continue
            occ.append((idx, end))
    occ.sort()
    return occ


def apply_gloss(html_str, gated_ids):
    """게이트 통과 용어의 한국어 등장을 전부 span.gl 로 감싼다.
    각 용어의 전역 첫 등장엔 기존 first_mark 병기(.anno)와 coinage 클래스를 합쳐 붙인다.
    skip_overlay 용어는 첫 등장 병기만 하고 본문 밑줄(.gl)은 달지 않는다."""
    active = [_by_id[i] for i in gated_ids if i in _by_id]
    active.sort(key=lambda g: max(len(f) for f in g["ko_forms"]), reverse=True)
    claimed, placements = [], []
    for g in active:
        wrappable = not g["skip_overlay"]
        first = not g["first_done"]
        if not wrappable and not first:           # 더 할 일 없음
            continue
        used = False
        for idx, end in _occurrences(html_str, g):
            if any(not (end <= cs or idx >= ce) for cs, ce in claimed):
                continue
            term = html_str[idx:end]
            is_first = first and not used
            if is_first:
                if wrappable:
                    cls = "gl coinage" if g["coin"] else "gl"
                    rep = f'<span class="{cls}" data-g="{g["id"]}" data-ty="{g["ty"]}">{term}</span>' + g["anno"]
                else:
                    rep = (f'<span class="coinage">{term}</span>' if g["coin"] else term) + g["anno"]
                g["first_done"] = True
            elif wrappable:
                rep = f'<span class="gl" data-g="{g["id"]}" data-ty="{g["ty"]}">{term}</span>'
            else:
                continue                          # skip_overlay: 첫 등장 외 미표시
            placements.append((idx, end, rep))
            claimed.append((idx, end))
            used = True
    for s, e, rep in sorted(placements, reverse=True):
        html_str = html_str[:s] + rep + html_str[e:]
    return html_str


def seg_html(tr):
    src = segs[tr["id"]]
    if src["kind"] == "scene-break":
        return '<hr class="scene">'
    ko_runs = tr.get("runs", [])
    body = apply_gloss(render_runs(ko_runs), gate_ids(src))
    cls = {"right": "ta-right", "center": "ta-center"}.get(src["align"], "")
    orig = render_orig(src["runs"])
    return (
        f'<p class="seg {cls}" id="{tr["id"]}" data-id="{tr["id"]}">'
        f'<button class="seg-handle" aria-label="문단 도구" tabindex="-1">⋮</button>'
        f'<span class="ko">{body}</span>'
        f'<span class="orig">{orig}</span></p>'
    )


_PART_KO_FALLBACK = {"Prologue": "프롤로그"}


def part_ko(name):
    """파트 이름의 한글 표기. 글로서리(정본) ko 우선, 없으면 폴백, 그것도 없으면 원문."""
    if not name:
        return ""
    g = gl.get(name)
    if g and g.get("ko"):
        return g["ko"]
    return _PART_KO_FALLBACK.get(name, name)


def build_body(cids, meta):
    """본문을 챕터 단위 <section class="chapter" id="chap-N"> 로 묶는다(리더의 페이징 단위).
    경계는 chapter_meta() 와 동일. 청크 경계와 무관하게 세그먼트 순서대로 연속 분할."""
    trs_all = []
    for cid in cids:
        f = TR / f"{cid}.jsonl"
        if not f.exists():
            continue
        trs_all += [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
    snips = {}
    for tr in trs_all:
        if segs[tr["id"]]["kind"] != "scene-break":
            snips[tr["id"]] = "".join(r["t"] for r in tr.get("runs", [])).strip()
    start_idx = {c["start"]: i for i, c in enumerate(meta)}
    parts = []
    open_ch = None
    prev_part = None
    for tr in trs_all:
        sid = tr["id"]
        if sid in start_idx:                              # 새 챕터 시작
            if open_ch is not None:
                parts.append('</section>')
            ci = start_idx[sid]
            title = html.escape(snips.get(meta[ci]["body"], "")[:40])
            raw_part = meta[ci]["part"]
            part = html.escape(str(raw_part or ""))
            parts.append(f'<section class="chapter" id="chap-{ci}" '
                         f'data-part="{part}" data-title="{title}">')
            if raw_part != prev_part:                     # 파트의 첫 챕터: 파트 제목(한글)을 에피그래프 위에 표시
                parts.append(f'<h2 class="part-title">{html.escape(part_ko(raw_part))}</h2>')
                prev_part = raw_part
            open_ch = ci
        parts.append(seg_html(tr))
    if open_ch is not None:
        parts.append('</section>')
    return "\n".join(parts), snips


def chapter_meta():
    """챕터 경계 = 우측 정렬 에피그래프(인용문) 블록. 각 챕터의 시작/본문/파트를 순서대로.
    build_toc(목차)와 build_body(섹션 분할)가 동일 경계를 쓰도록 단일 소스."""
    seq = list(segs.items())
    n = len(seq)
    meta = []
    i = 0
    while i < n:
        s = seq[i][1]
        if not (s["kind"] == "para" and s["align"] == "right"):
            i += 1
            continue
        start = seq[i][0]                          # 에피그래프 블록 시작(파트 헤더 앵커)
        j = i
        while j < n and seq[j][1]["kind"] == "para" and seq[j][1]["align"] == "right":
            j += 1                                  # 연속 우측 정렬 = 인용문 블록(여러 줄 포함)
        k = j
        while k < n and seq[k][1]["kind"] == "scene-break":
            k += 1                                  # 블록 다음 첫 본문 문단 = 챕터 제목·앵커
        body = seq[k][0] if k < n else start
        meta.append({"start": start, "body": body, "part": s.get("part")})
        i = j
    return meta


def build_toc(snips, meta):
    """파트(헤더) + 챕터 목차. 챕터 제목 = 에피그래프 직후 첫 본문 문단의 번역 스니펫."""
    items = []
    cur_part = None
    chap_no = 0
    for c in meta:
        part = c["part"]
        if part != cur_part:
            cur_part = part
            chap_no = 0
            items.append(f'<li class="toc-part"><a href="#{c["start"]}">'
                         f'{html.escape(part_ko(part))}</a></li>')
        chap_no += 1
        snip = html.escape(snips.get(c["body"], "")[:30])
        items.append(f'<li class="toc-scene"><a href="#{c["body"]}">'
                     f'<span class="toc-n">{chap_no}</span>{snip}…</a></li>')
    return "\n".join(items)


def _self_check():
    """게이팅·래핑 핵심 동작 자가검증(상태 보존). 실패 시 빌드 중단."""
    def gate_text(t):
        return gate_ids({"runs": [{"t": t}]})

    scr = next((g for g in gloss_list if g["ko"] == "스크램블러"), None)
    if scr:
        assert scr["id"] in gate_text("The scrambler moved."), "gate 실패: 소문자 단수"
        assert scr["id"] in gate_text("Two scramblers attacked."), "gate 실패: 복수"
        saved, scr["first_done"] = scr["first_done"], True   # 첫등장 분기 회피, 순수 .gl 확인
        out = apply_gloss("스크램블러를 보았다", {scr["id"]})
        scr["first_done"] = saved
        assert 'class="gl"' in out and "스크램블러" in out, "wrap 실패: 스크램블러를"
        # 게이트: 원문 영어에 표제어가 없으면 한국어가 있어도 미표시
        out = apply_gloss("스크램블러를 보았다", gate_text("Nothing relevant in this sentence."))
        assert 'class="gl"' not in out, "게이트 실패: 비게이트 세그먼트에 표시됨"
    print("self-check OK | glossary terms:", len(gloss_list))


def main():
    _self_check()
    cids = sys.argv[1:] or [c for c in order if (TR / f"{c}.jsonl").exists()]
    cids = [c for c in cids if (TR / f"{c}.jsonl").exists()]

    template = (TPL / "reader.html").read_text(encoding="utf-8")
    styles = (TPL / "reader.css").read_text(encoding="utf-8")
    script = (TPL / "reader.js").read_text(encoding="utf-8")

    meta = chapter_meta()
    body, snips = build_body(cids, meta)
    toc = build_toc(snips, meta)
    built_info = f"{len(cids)}개 청크"
    # CSS/JS 는 HTML 주석 마커로 인라인(에디터 포매터가 <style>{{..}}</style> 를 깨뜨리는 것 방지)
    gloss_js = "<script>window.__GL__=" + json.dumps(gloss_map, ensure_ascii=False) + ";</script>"
    out_html = (template
                .replace("<!--{{STYLES}}-->", f"<style>\n{styles}\n</style>")
                .replace("<!--{{GLOSSARY}}-->", gloss_js)
                .replace("<!--{{SCRIPT}}-->", f"<script>\n{script}\n</script>")
                .replace("{{BUILT_INFO}}", built_info)
                .replace("{{TOTAL}}", str(len(segs)))
                .replace("{{TOC}}", toc)
                .replace("{{BODY}}", body))  # BODY 마지막: 본문에 {{...}} 가 있어도 안전
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out_html, encoding="utf-8")
    print("built", OUT, "| chunks:", len(cids), "| .gl spans:", body.count("data-g="))


if __name__ == "__main__":
    main()
