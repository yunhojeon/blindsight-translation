# Blindsight 한국어 번역 프로젝트

피터 와츠의 하드 SF 『Blindsight』(CC BY-NC-SA 2.5)를 한국어로 번역해 온라인 공유하는 프로젝트.
설계 전문은 `번역_설계.md`, 진행 상태는 `data/STATUS.md` 참조.

## 핵심 원칙 — 번역 데이터와 표현(presentation)의 분리
- `data/` 의 번역·용어집·인물 데이터가 **정본(single source of truth)**.
- 독자가 보는 HTML(`dist/`)은 `build/build_reader.py` 가 데이터로부터 **생성**한다.
- 표현(색·레이아웃·원어 병기 방식)을 바꿀 때 **번역을 다시 하지 않는다** — 빌드만 다시 돌린다.
- segment `id`(s0001..)는 **불변**. 번역·원문 토글·하이라이트·공유 URL이 모두 이 id를 참조한다.

## 파이프라인 (순서대로)
```
python3 build/extract.py          # 원본 HTML → data/segments.jsonl, data/watts_notes.json  (1회성)
python3 build/build_glossary.py   # CSV + 큐레이션 → data/glossary.json
python3 build/chunk.py            # segments → data/chunks/*.json (+ chunks_manifest.json)
bash    build/translate.sh        # 청크별 번역 → data/translations/*.jsonl (재개 가능)
python3 build/validate.py         # id·이탤릭·장면·locked 용어·말투 일괄 검증
python3 build/build_reader.py     # 번역 → dist/preview.html (templates/ 인라인 합성)
```
- 번역 호출 구조: `translate.sh` → 청크마다 `translate_split.py`(작은 배치로 분할 호출 → `parse_result.py`로 병합). 큰 청크를 한 번에 번역하면 32k 출력 한도/폭주로 실패하기 때문.
  - 배치 크기 `BATCH`(기본 10), 모델 `MODEL`(기본 sonnet), 배치 타임아웃 `BATCH_TIMEOUT`(기본 600초) 환경변수로 조정.
- 사용량 한도로 끊기면: `bash build/translate_loop.sh` 가 한도 중단→대기→자동 재개(전부 완료까지).
- 재실행 안전: extract/glossary/chunk는 멱등. translate.sh는 비어있지 않은 출력은 건너뛴다(`-s`), 배치는 `.work/<chunk>.b<k>.json`에 캐시.
- 단일 청크 진단: `python3 build/translate_split.py s0149-s0181`

## 데이터 스키마
- `data/segments.jsonl` (불변): `{id, kind(para|scene-break), align(justify|center|right), part, scene, text, runs}`. `runs`=`[{t, i?}]`, `i:true`=원문 이탤릭.
- `data/translations/<chunk>.jsonl`: `{id, status, runs, speaker, addressee, register, glossary_used, translator_note, revision}`. **runs에는 한국어만**(원어 병기는 빌드가 처리). run.`i`: `true`(미분류 이탤릭) 또는 목적 문자열 `"thought|emphasis|foreign|title|comm|other"`(빌드가 `.ital.i-<kind>` 로 렌더). 내적 독백은 speaker/addressee=null(서술 취급).
- `data/glossary.json`: en→`{ko, strategy(transliterate|translate|keep), type(neologism|proper|science), aliases?, first_mark{en,hanja,title_link}, coinage?, note, note_level, first_seen, locked, review?}`.
- `data/characters.json`: `characters` + `register_matrix`("화자->청자":{register, basis}) + `register_events`.

## 번역 규칙 (요약, 전문은 build/translate_system.md)
- 서술(시리 1인칭): **평어체**(~다/~었다). 와츠의 짧고 건조한 어조 유지.
- 대화: `register_matrix`로 존댓말/반말 결정. 매트릭스에 없는 쌍은 관계로 정하고 `register_checks`에 기록.
- 확정(locked) 용어: glossary의 ko를 정확히. **원어/한자 병기는 넣지 않는다**(빌드가 first_mark로 자동 부착).
- 이탤릭: 강조 의미에 해당하는 한국어 run에 `i` 유지(`true` 또는 목적 종류 문자열). 내적 독백/회상은 speaker/addressee 비우고 서술 평어체로.
- 음차 vs 의역: 작품 고유명사/어색한 번역어는 음차(스크램블러), 정착 과학용어는 표준 번역어(맹시). 의역 고유명사(반딧불이)는 coinage 색 구분.

## 표현 규칙 (build_reader.py + build/templates/)
- HTML/CSS/JS 는 `build/templates/`의 `reader.html`·`reader.css`·`reader.js`. 빌드가 이를 dist/preview.html 에 **인라인 합성**(단일 파일 산출). 표현을 바꾸려면 이 파일들을 편집하고 재빌드.
- 이탤릭 → 목적별 `.ital.i-<kind>`(생각/강조/외국어/이름/통신/기타·미분류), coinage 첫 등장 → `.coinage`, first_mark → 첫 등장 `한글(English[, 漢字])` 자동 병기.
- 용어 해설(`.gl` 밑줄 오버레이): **세그먼트 원문 영어에 glossary 키/aliases(영어 표면형)가 등장할 때만**(게이트) 그 세그먼트의 한국어 ko/aliases를 밑줄. ⚠️ 따라서 **glossary 키는 원문(segments.jsonl)의 정확한 영어 철자와 일치해야** 한다 — 키가 원문과 다르면 해당 용어는 조용히 밑줄이 안 붙는다(원문 오타 변형은 `aliases`에 추가해 커버). 예: 원문 정본은 `Burns-Caulfield`, 원문 오타 1곳(s0314)은 `Burns-Caufield`를 alias로.
- 문단별 인라인 원문 토글, 전역 원문/병기 토글(localStorage 기억), 정렬·scene-break 보존.

## 진행 상황
- **번역 초벌 전체 완료: s0001–s3667 (51청크 3,667 segment), validate 통과.** dist/preview.html 전체 재빌드.
- 남은 작업: 이탤릭 목적 분류(약 2,000개, 별도 스크립트), 말투 검토 항목(`data/review_items.md`), 문체 일관성 검수, 와츠 권말 주석 번역.

## 주의
- 인증: `CLAUDE_CODE_OAUTH_TOKEN` 파일이 있으면 translate.sh가 자동 로드(이 파일은 절대 커밋 금지).
- 와츠 권말 '주석과 참고문헌' 144개는 본문이 아니라 `watts_notes.json`에 별도 보관(추후 별도 섹션 번역).
- 라이선스: 번역본도 CC BY-NC-SA로 공유. reader에 원작자·출처·라이선스 명시.
