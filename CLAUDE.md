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

## 향후 프로세스 개선 (별도 프로젝트로 분리 · 다른 소설에도 재사용 대비)
> 코드를 Blindsight 전용에서 **범용 번역 파이프라인**으로 분리할 때의 설계 방향. 아래는 이번 프로젝트에서
> 실제로 겪은 실패에서 도출한 것. (현 코드는 아직 미수정 — 재작성 시 반영.)

### 원칙 1 — 전 과정 고급 모델(Opus 등)로, "리뷰-수정"보다 "한 번에 제대로"
- 초벌을 Sonnet로 하고 나중에 리뷰·수정하는 방식은 **리뷰 자체가 새 오류를 유발**했다(이번 세션 실증):
  환각 삽입(원문에 없는 문장 지어내기), 내용 드롭(문장·대사 통째 삭제), 이탤릭 마커 오염.
- 왕복(초벌→평문 리뷰→재적용)은 손실·왜곡을 만든다. **처음부터 고품질 1회 통과**가 총비용·품질 모두 유리.

### 원칙 2 — 2-pass: ①용어·인물 확정 → ②번역
이번 세션의 용어 드리프트(probe/scout/grunt/waldo/jargonaut가 제각각 + glossary 이중 항목)의 **근본 원인은
청크별 번역 시점에 glossary가 미완성이라 매 청크가 즉석 음차**한 것. 해법:
- **Pass 1 (번역 문장 생성 안 함)**: 전 청크를 훑어 **glossary·characters를 전역으로 구축·확정·동결**.
  - 형태 변이(grunt/grunts, waldo/waldoes)는 **한 항목 + aliases**로 병합(단수/복수 별도 항목 금지).
  - 같은 지시대상 그룹(probe/scout/drone 등)의 렌더를 **한 번에 통일** 결정.
  - 전략(transliterate/translate/coinage)·ko 확정 후 distinctive 조어·고유명은 **lock**(안 하면 번역에 미전달 + validate 미검출).
  - `register_matrix`·인물 `narration_style`도 이 단계에서 확정.
  - 산출: **동결된 glossary/characters**(Pass 2 도중 변경 금지).
- **Pass 2 (번역)**: 동결 데이터를 캐시 시스템 프롬프트로 싣고 **전권 고품질 1회 번역**.
  - 이탤릭 목적 분류(thought/emphasis/foreign/title/comm/other)를 **그 자리에서 확정**(별도 pass 불필요).
  - **출력은 구조화(runs + i 목적코드 JSON)** — 인라인 텍스트 마커(`*코드:텍스트*`) 왕복 금지(이번 오염 원인).

### 청킹 · 프롬프트 캐싱 (루프 실행 효율)
Pass 1·2 모두 청크를 순차 루프로 돌린다. 각 청크 호출은 **동결 데이터(glossary/characters/규칙)를 캐시 프리픽스**로 싣는다.
- **1차 전략 — turn당 출력을 목표시간/토큰으로 bound(짧은 turn).** 근거는 캐시가 아니라 **출력 품질/신뢰성**이다:
  큰 청크를 한 번에 생성하는 방식은 이번 프로젝트에서 32k 출력 한도·폭주·과압축(문장 드롭)·환각·장문 드리프트로 실패했다(위 "안티패턴" 참조). 짧은 출력이 견고.
  **부수 효과**: turn이 5분 이내면 아래 TTL 갱신 시점이 무엇이든 **무관하게** 다음 호출이 5분 창 안에 도달 → 안정적 캐시 hit. TTL 의미론 논쟁을 통째로 우회한다.
- **TTL 세부는 미확정(구현 세부)**: 캐시 TTL 갱신 시점(prefill 시작 vs 생성 종료)과 eviction 정책(LRU vs 순수 만료)은 **공개 문서에 없다**.
  보장되는 건 "**최소 5분 수명, 사용될 때마다 갱신**"뿐. 그래서 위처럼 turn을 5분 이내로 두면 이 미확정을 해결할 필요가 없다.
- **1h TTL은 병행(상호배타 아님)**: 짧은 turn이어도 `translate_loop.sh`가 사용량 한도로 **5분 넘게 대기 후 재개**하는 구간은 5분 캐시가 죽는다.
  → 1h 확장 TTL(SDK `cache_control ttl:"1h"`, 또는 `claude -p`는 env `ENABLE_PROMPT_CACHING_1H=1`)로 그 gap을 방어. **정상 구간=짧은 turn, 대기 구간=1h TTL.**
- ⚠️ **전제 — 캐시 경로가 정확할 때만 이득이 성립**. 캐시는 **`cache_control` breakpoint 위치에서만** 엔트리를 만든다(임의의 "안정 프리픽스"를 자동 캐시하지 않는다).
  ⇒ 규칙: **고정 데이터 뒤에 breakpoint를 두고, 가변(그 청크 원문·번역)은 그 breakpoint 뒤**에 둔다. 렌더 순서는 tools→system→messages.
  배치가 틀리면(고정을 가변 뒤 breakpoint에 두면) 짧은 turn은 hit를 못 만들고 write만 곱해 오히려 나빠진다.
  이번 세션 실패: ARG_MAX 회피로 고정 블록을 **user 메시지(stdin)** 에 `[고정][가변]`으로 넣었는데, 고정/가변 경계에 breakpoint가 없어(유일 breakpoint는 메시지 끝=가변 뒤) 매 청크 프리픽스가 달라져 write가 찍혔다. 고정 블록을 **system 경로**에 뒀으면 가변 앞에서 프리픽스가 끊겨 hit 났을 것.
- **`claude -p`는 raw `cache_control`을 노출하지 않는다**: 3계층(system / project=CLAUDE.md 등 / conversation)을 자동 캐싱하며 블록별 breakpoint·TTL을 직접 못 준다.
  제어는 env로만: `ENABLE_PROMPT_CACHING_1H=1`(1h, API 키), `FORCE_PROMPT_CACHING_5M=1`, `DISABLE_PROMPT_CACHING=1`(+모델별). `--append-system-prompt`가 캐시 프리픽스에 포함되는지는 미확정.
  **명시적 breakpoint·per-message 세밀 제어가 필요하면 anthropic SDK로 Messages API를 직접 호출**한다(범용 파이프라인 재작성 시 이 분기 고려).
- **검증은 실측으로**: 응답 `usage.cache_read_input_tokens` vs `cache_creation_input_tokens`.
  청크마다 `cache_creation`(write)만 크면 캐시 미적중 → 경로(breakpoint 위치)·프리픽스 불변성·TTL을 점검.
- **프리픽스 불변 규약**: 캐시는 프리픽스 바이트 정확일치. 타임스탬프·정렬 안 된 JSON·청크마다 바뀌는 tool 목록이 프리픽스 앞에 있으면 매번 무효화.
  동결 데이터는 **바이트 단위로 고정**(정렬된 직렬화)한다.
- ⚠️ **Pass 1은 캐시 이득이 제한적**: glossary가 청크마다 커지므로(프리픽스가 변함) 재사용이 깨진다.
  Pass 1은 "규칙+누적 요약"만 안정 프리픽스로 캐시하고, 큰 이득은 **동결 데이터가 불변인 Pass 2**에서 노린다.

### 번역가(사람) 검토 루프 · 인터랙티브 도구
사람이 개입하는 지점을 **결정은 한 번, 적용은 도구가 일관·형태소 인식으로** 하도록 설계.
- **Pass 1 후 — 용어·인물 확정 검토**: LLM이 만든 glossary/character 관계를 번역가가 최종 승인·수정.
  - 이를 위한 **번역가용 부가 데이터**가 필요: 각 용어의 **용례 목록(KWIC — 원문 문장 + 앞뒤 맥락, 등장 위치)**,
    제안 ko·전략·근거, 단수/복수 변이, 같은 지시대상 그룹. → 번역가가 **한 번 결정하면 전 등장에 반영**.
  - ⚠️ 이 검토용 데이터(용례·맥락)는 **Pass 2에서 LLM에 전달하지 않는다** — 동결 glossary만 전달(프롬프트 비대화·잡음 방지).
    **번역가-facing 메타데이터**와 **LLM-facing 정본**을 분리.
- **Pass 2 후 — 확정 대기 플래그**: LLM이 애매해 confirm이 필요한 부분(말투 불확실, 용어 선택 애매, 이탤릭 목적 불확실,
  오역 의심 등)을 **사유·신뢰도와 함께 flag**. 번역가가 모아서 일괄 확정.
- **연관 수정 그룹핑 + 형태소 인식 일괄 적용**: 이번 grunt처럼 한 결정이 수십 세그먼트에 걸치면 **하나의 결정 단위로 묶어 제시**
  → 번역가가 한 번 고르면 도구가 **조사·수사까지 맞춰 일괄 적용**(병사 한 명→전투봇 한 기, 영토을→영토를 자동).
  세그먼트마다 손으로 고치던 이번 방식의 고통을 제거.
- **구현 수단**: 위 흐름(그룹 결정 → 형태소 인식 적용, 용례 열람, 플래그 확정)은 인터랙티브가 필요 →
  **Skill(슬래시 명령)** 또는 **별도 로컬 도구**(리더가 이미 웹앱이니 번역가용 웹 검토 UI가 자연스러움).

### 반드시 피할 안티패턴 (이번 세션 실패 모드)
- 인라인 마커 왕복 → 코드 접두어 누출(`e:탄력`), 마커 불균형으로 본문 오염.
- LLM "리뷰-수정" 패스 → 환각 삽입·과압축(내용 드롭). 리뷰는 **안전망**이지 주 품질수단이 아님.
- 문자열 치환식 사후 용어 통일 → **조사·수사 오류**(병사 한 명→전투봇 한 기, 영토을→영토를). 처음부터 맞게.
- glossary 단수/복수 이중 항목(서로 다른 ko) · `strategy` 오기(transliterate인데 ko는 의역).
- 미확정(unlocked) 조어·고유명 → 번역에 미전달되어 즉석 음차 드리프트, validate가 못 잡음.

### QA는 안전망으로만 (주 품질은 Pass 2가 담당)
- validate를 **locked뿐 아니라 전체 용어 일관성**으로 확장(원문에 표제어 있는데 ko 없는 세그먼트).
- **근접-변형(오음차) 검사**(같은 음차어의 편집거리1 변형: 월도↔발도, 코먼스↔커먼스).
- **환각/순수삽입 검사**(백업 대비 대응 삭제 없는 연속 추가), **길이비 이상치**(과압축·과확장).
- 이 프로젝트에 만든 `review_chunk.py`/`review_scan.py`/`review_diff.py`는 안전망 도구로 재사용 가능하되, Pass 방식이 바뀌면 재설계.

### 재사용(범용화) 메모
- 데이터/표현 분리는 그대로 유지(정본 `data/` → 빌드 `dist/`). segment id 불변 규약도.
- 소설별로 달라지는 것: 원본 소스(extract), 인물/말투, glossary. 스키마는 이미 범용적.
- 라이선스: 소스가 CC/퍼블릭도메인인지 확인, 번역본도 동일 조건 공유.

## 주의
- 인증: `CLAUDE_CODE_OAUTH_TOKEN` 파일이 있으면 translate.sh가 자동 로드(이 파일은 절대 커밋 금지).
- 와츠 권말 '주석과 참고문헌' 144개는 본문이 아니라 `watts_notes.json`에 별도 보관(추후 별도 섹션 번역).
- 라이선스: 번역본도 CC BY-NC-SA로 공유. reader에 원작자·출처·라이선스 명시.
