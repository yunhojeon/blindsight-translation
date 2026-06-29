#!/usr/bin/env python3
"""
build_glossary.py — 기존 용어집 CSV + 큐레이션 결정을 합쳐 data/glossary.json 시드를 만든다.

- strategy: transliterate(음차) / translate(의역) / keep(원어)
- first_mark: 첫 등장 시 빌드가 붙일 병기. {en, hanja, title_link}
- coinage: 의역한 고유명사의 첫 등장 색 구분 플래그
- first_seen: segments.jsonl 을 스캔해 자동 계산(가능한 경우). 모호하면 review=True
- locked: 번역 확정 플래그(시드는 핵심 항목만 잠금)

설계서 §2.3 / §2.3.1 / 부록 A 의 결정을 코드로 고정. 사람이 검토 후 조정 가능.
"""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEG = ROOT / "data" / "segments.jsonl"
CSV = ROOT / "블라인드사이트 용어집.csv"
OUT = ROOT / "data" / "glossary.json"

# 큐레이션 결정 테이블. key = 영어 원형.
# t=type(neologism/proper/science), s=strategy, ko=번역어, en/hanja/title=first_mark,
# coin=coinage, aliases, lock
CURATED = {
    # --- 작품 고유명사: 음차 ---
    "Scrambler":   dict(t="neologism", s="transliterate", ko="스크램블러", en=1, aliases=["scramblers", "scrambler's"], lock=1),
    "ConSensus":   dict(t="neologism", s="transliterate", ko="콘센서스", en=1, aliases=["Consensus"], lock=1),
    "skimmer":     dict(t="neologism", s="transliterate", ko="스키머", en=1, aliases=["skimmers"], lock=1),
    "telematter":  dict(t="neologism", s="transliterate", ko="텔레매터", en=1, lock=1),
    "alter":       dict(t="neologism", s="transliterate", ko="얼터", en=1, aliases=["alters"], review=1),
    "omnisavantism": dict(t="neologism", s="transliterate", ko="옴니서번티즘", en=1),
    "baseline":    dict(t="neologism", s="translate", ko="기본형", en=1, aliases=["baselines"], note="흡혈귀·개조인을 제외한 보통 인간.", review=1),
    "Transient Attitudinal Tweak": dict(t="neologism", s="translate", ko="일시적 태도 조정", en=1, aliases=["TAT"], lock=1),
    "Crucifix glitch": dict(t="neologism", s="translate", ko="십자가 결함", en=1, note="직각을 보면 발작하는 흡혈귀의 유전적 결함.", review=1),
    "antiEuclidean": dict(t="neologism", s="translate", ko="반(反)유클리드", en=1, hanja=None, note="흡혈귀가 직각을 견디게 해주는 장치/약물.", review=1),
    "Synthesist":  dict(t="neologism", s="translate", ko="종합가", en=1, note="주인공 시리의 직업. 이해하지 않고 패턴만 종합해 보고한다.", lock=1),
    "Fireflies":   dict(t="neologism", s="translate", ko="반딧불이", en=1, coin=1, note="갑자기 대기권에 나타났다 수십 초 만에 사라진 65,536개의 외계 물체. 실제 곤충이 아니라 붙인 이름.", lock=1),
    "The Gang of Four": dict(t="neologism", s="translate", ko="4인방", en=1, aliases=["Gang of Four"], note="언어학자 수잔 제임스의 다중 인격(수잔/미셸/사샤/계산가).", lock=1),

    # --- 인명·함선·천체: 음차(proper) ---
    "Siri Keeton": dict(t="proper", s="transliterate", ko="시리 키튼", en=1, aliases=["Keeton"], lock=1),
    "Isaac Szpindel": dict(t="proper", s="transliterate", ko="아이작 스핀델", en=1, aliases=["Szpindel"], lock=1),
    "Jukka Sarasti": dict(t="proper", s="transliterate", ko="주카 사라스티", en=1, aliases=["Sarasti"], lock=1),
    "Amanda Bates": dict(t="proper", s="transliterate", ko="어맨다 베이츠", en=1, aliases=["amanda Bates", "Bates"], lock=1),
    "Robert Cunningham": dict(t="proper", s="transliterate", ko="로버트 커닝햄", en=1, aliases=["Cunningham"], lock=1),
    "Theseus":     dict(t="proper", s="transliterate", ko="테세우스", en=1, note="외계 조우 임무를 수행하는 우주선.", lock=1),
    "Rorschach":   dict(t="proper", s="transliterate", ko="로르샤흐", en=1, note="빅 벤을 공전하는 외계 구조물.", lock=1),
    "Big Ben":     dict(t="proper", s="transliterate", ko="빅 벤", en=1, note="오르트 구름의 목성 10배 크기 천체(준갈색왜성).", lock=1),
    "Icarus Array": dict(t="proper", s="transliterate", ko="이카루스 어레이", en=1, aliases=["Icarus"], note="태양 에너지로 반물질을 만드는 시설.", lock=1),
    "Burns-Caufield": dict(t="proper", s="transliterate", ko="번스-카우필드", en=1, note="카이퍼 벨트에서 접근하는 혜성.", lock=1),
    "Jack":        dict(t="proper", s="transliterate", ko="잭", en=1, note="테세우스가 만든 소형 탐사선('깜짝상자 잭').", review=1),
    "Charybdis":   dict(t="proper", s="transliterate", ko="카리브디스", en=1, note="테세우스의 셔틀.", review=1),

    # --- 과학용어: 의역 유지(정착어), 필요시 원어/한자 병기 ---
    "blindsight":  dict(t="science", s="translate", ko="맹시", en=1, hanja="盲視", title=1, note="V1 손상으로 생기는 시각장애. 보이지 않는다고 보고하면서도 물체 위치·운동을 맞힌다. 이 작품의 제목(국내 통용 '블라인드사이트').", lock=1),
    "topology":    dict(t="science", s="translate", ko="위상", en=1, hanja="位相", note="시리가 상대에게서 읽어내는 비언어적 정보 구조를 가리킨다.", review=1),
    "noosphere":   dict(t="science", s="translate", ko="인지권", en=1, hanja="認知圈", note="인류의 지적 활동 전체의 권역. 작중에선 거대 네트워크의 의미.", lock=1),
    "qualia":      dict(t="science", s="translate", ko="감각질", en=1, hanja="感覺質", note="어떤 것을 지각할 때 느끼는 주관적 질감. 말로 표현하기 어렵다.", lock=1),
    "phenotype":   dict(t="science", s="translate", ko="표현형", en=1, hanja="表現型", note="겉으로 드러나는 형질(육체·행동). 유전형의 반대. 작중 '확장된 표현형'은 신체 확장(로봇팔 등).", lock=1),
    "saccade":     dict(t="science", s="translate", ko="단속운동", en=1, note="시선이 한 점에서 다른 점으로 급격히 도약하는 불수의적 안구 운동.", lock=1),
    "agnosia":     dict(t="science", s="translate", ko="실인증", en=1, hanja="失認症", aliases=["agnosias"], note="사물의 위치·파지는 가능하나 그 의미·종류를 인출하지 못하는 인지장애('아내를 모자로 착각한 남자').", lock=1),
    "neglect":     dict(t="science", s="translate", ko="편측공간무시", en=1, note="한쪽 시각영역 손상으로 그쪽 공간을 통째로 무시하는 증상(시계의 절반만 그림).", review=1),
    "synesthesia": dict(t="science", s="translate", ko="공감각", en=1, hanja="共感覺", note="한 감각 자극이 다른 감각을 동시에 일으키는 신경 현상(소리에서 색을 느낌).", lock=1),
    "inattentional blindness": dict(t="science", s="translate", ko="부주의맹", en=1, note="주의를 두지 않은 자극의 변화를 알아채지 못함('보이지 않는 고릴라').", lock=1),
    "Chinese room": dict(t="science", s="translate", ko="중국어 방", en=1, note="존 설의 사고실험. 의미 이해 없이도 규칙만으로 대화가 가능하다는 논변.", lock=1),
    "von Neumann machine": dict(t="science", s="translate", ko="폰 노이만 기계", en=1, note="자기복제가 가능한 기계.", lock=1),
    "Kuiper Belt": dict(t="science", s="translate", ko="카이퍼 벨트", en=1, note="해왕성 궤도 밖의 천체 띠.", lock=1),
    "Klüver constant": dict(t="science", s="translate", ko="클뤼버 상수", en=1, aliases=["Kluver"], note="환각 상태에서 보이는 보편적 시각 패턴(form constant).", review=1),
    "visual cortex": dict(t="science", s="translate", ko="시각피질", en=1, review=1),
    "Grey Syndrome": dict(t="science", s="translate", ko="회색아 증후군", en=1, note="클로람페니콜 과다 시 신생아에게 나타나는 중독 증상.", review=1),
    "monofilament": dict(t="science", s="translate", ko="단섬유", en=1, review=1),
    "Turing Morphogen": dict(t="science", s="translate", ko="튜링 모르포겐", en=1, note="세포의 증식·분화를 제어해 형태를 만드는 요소.", review=1),
    "Proprioreceptive polyneuropathy": dict(t="science", s="translate", ko="고유수용성 다발신경병증", en=1, note="고유수용감각(자기 신체 위치 감각)이 손상되는 신경병증.", review=1),
    "TMS": dict(t="science", s="translate", ko="경두개 자기자극", en=1, aliases=["transcranial magnetic stimulation"], note="자기장으로 뇌 특정 부위 기능을 일시 정지시키는 비침습 기법.", lock=1),
}

# CSV 원본 설명을 fallback 주석으로 쓰기 위해 로드
csv_desc = {}
with CSV.open(encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        en = (r.get("영문이름") or "").strip()
        desc = (r.get("설명") or "").strip()
        if en and not en.startswith("http"):
            csv_desc[en] = desc

# segments 로드(첫 등장 스캔용)
segs = [json.loads(l) for l in SEG.open(encoding="utf-8")]


def find_first_seen(term, aliases):
    pats = [term] + list(aliases or [])
    # 단어 경계 기반, 대소문자 무시. 가장 이른 segment.
    regexes = []
    for p in pats:
        if re.fullmatch(r"[A-Za-z][A-Za-z' \-]*", p):
            regexes.append(re.compile(r"\b" + re.escape(p) + r"\b", re.I))
        else:
            regexes.append(re.compile(re.escape(p), re.I))
    for s in segs:
        if s["kind"] != "para":
            continue
        for rx in regexes:
            if rx.search(s["text"]):
                return s["id"]
    # 2차: 단일 어절 ASCII 용어는 어간 + 접미(s/es/-) 변형 허용 (복수형 등)
    relaxed = []
    for p in pats:
        if re.fullmatch(r"[A-Za-z]+", p):
            relaxed.append(re.compile(r"\b" + re.escape(p) + r"\w*", re.I))
        elif " " in p and re.fullmatch(r"[A-Za-z ]+", p):
            # 다어절: 첫 의미 단어로 재시도
            head = p.split()[-1]
            relaxed.append(re.compile(r"\b" + re.escape(head) + r"\w*", re.I))
    for s in segs:
        if s["kind"] != "para":
            continue
        for rx in relaxed:
            if rx.search(s["text"]):
                return s["id"]
    return None


glossary = {}
for en, d in CURATED.items():
    entry = {
        "ko": d["ko"],
        "strategy": d["s"],
        "type": d["t"],
    }
    if d.get("aliases"):
        entry["aliases"] = d["aliases"]
    fm = {}
    if d.get("en"):
        fm["en"] = True
    if d.get("hanja"):
        fm["hanja"] = d["hanja"]
    if d.get("title"):
        fm["title_link"] = True
    if fm:
        entry["first_mark"] = fm
    if d.get("coin"):
        entry["coinage"] = True
    note = d.get("note") or csv_desc.get(en, "")
    note = re.sub(r"\s+", " ", note).strip()
    if note:
        entry["note"] = note
        entry["note_level"] = "science" if d["t"] == "science" else "spoiler-safe"
    fs = find_first_seen(en, d.get("aliases"))
    entry["first_seen"] = fs
    entry["locked"] = bool(d.get("lock"))
    if d.get("review") or fs is None:
        entry["review"] = True  # 사람이 first_seen/번역어 확인 필요
    glossary[en] = entry

OUT.write_text(json.dumps(glossary, ensure_ascii=False, indent=2), encoding="utf-8")

# 요약
by_s = {}
for e in glossary.values():
    by_s[e["strategy"]] = by_s.get(e["strategy"], 0) + 1
no_fs = [k for k, e in glossary.items() if e["first_seen"] is None]
print("glossary entries:", len(glossary))
print("by strategy:", by_s)
print("locked:", sum(1 for e in glossary.values() if e["locked"]))
print("need review:", sum(1 for e in glossary.values() if e.get("review")))
print("first_seen NOT found:", no_fs)
