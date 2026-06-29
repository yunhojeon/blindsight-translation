# Phase 1 산출물 — 번역 데이터 기반

원본 HTML을 구조화 데이터로 추출하고, 용어집·인물 매트릭스·청크를 시드로 만들었다.
번역(Phase 2)과 표현(빌드)은 이 데이터 위에서 독립적으로 동작한다.

## 파일

- `segments.jsonl` — 본문 3,667 segment(불변 id `s0001..`). 필드: id, kind(para/scene-break), align(justify/center/right), part, scene, text, runs(이탤릭 보존).
- `watts_notes.json` — 와츠 '주석과 참고문헌' 부록의 각주 144개(en 원문 / ko 빈칸).
- `glossary.json` — 용어집 45항목. strategy(transliterate/translate), first_mark(en/hanja/title_link), coinage, first_seen, locked, review.
- `characters.json` — 인물 10명 + 방향성 존댓말 매트릭스 26쌍 + register_events.
- `chunks/*.json` — 번역 단위 51개(평균 1,864 단어, 장면·파트 경계 존중). 각 파일에 원본 segment 포함.
- `chunks_manifest.json` — 청크 목록 요약.

## 재생성

```
python3 build/extract.py         # HTML -> segments.jsonl, watts_notes.json
python3 build/build_glossary.py  # CSV + 큐레이션 -> glossary.json
python3 build/chunk.py           # segments -> chunks/
```

## 검토 필요(review=true)

- glossary: 14항목(음차/번역어·first_seen 확인). `neglect`는 first_seen 자동탐색 실패 → 수동 지정.
- characters: 매트릭스 전체가 시드(번역가 확정 필요). Siri↔Chelsea 말투 전환 segment id(`register_events`) 미지정.

## 다음 단계(Phase 2)

용어집·매트릭스를 사람이 확정·locked → `claude -p` 스크립트 루프로 청크별 번역(translations/ 에 저장)
→ 신규 용어는 glossary 에 머지 → 사후 검증. (설계서 §10 참조)
