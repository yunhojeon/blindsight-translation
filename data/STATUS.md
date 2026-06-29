# 진행 상태

## 완료
- **번역 초벌 전체 완료: s0001–s3667 (51청크 3,667 segment).** `validate.py` 통과(경고는 아래 검토 항목).
- 번역 방식: s0001–s0148(3청크)은 Opus 직접, 나머지는 `translate_loop.sh`(Sonnet, 배치 10)로 자동 완료.
- `dist/preview.html` 전체(51청크) 재빌드.

## 파이프라인 변경 이력(폭주·한도 대응)
- 큰 청크 단일 `claude -p` 호출이 32k 출력 한도/폭주로 실패 → **`translate_split.py`** 가 청크를 작은 배치(기본 10)로 나눠 호출, 결과를 `parse_result.py`로 합침. `translate.sh` 가 이를 호출.
- 구독 **사용량 한도(session limit)** 로 중간중간 끊김 → **`translate_loop.sh`** 가 한도 시 중단→대기→자동 재개(전부 완료까지). 재개 안전(완료 청크 -s 가드 + 배치 캐시).
- 토큰 효율: 고정 데이터(glossary/matrix/characters)를 캐시되는 시스템 프롬프트로 이동, 모델 Sonnet.

## 검토 항목 (validate 경고) → 상세: `data/review_items.md`
- **말투 19**: 대부분 매트릭스가 정적이라 생긴 것. Siri↔Chelsea 첫 만남(존댓말)·Sascha→Siri·Cunningham 격분 등은 register_events 에 기록. Sarasti 내적 독백(s3029–s3035)은 narration 으로 재태깅(speaker null)해 해소.
- **이탤릭 손실 6**: s0862/s0979/s3081(함선명 Rorschach), s1094/s2054/s2875(강조) → `i:true` 복원 완료(목적 분류는 추후).
- **확정용어 8**: 대부분 인명을 대명사로 받은 오탐. TAT(s0611)는 'tit-for-tat' 오탐(validate 약어 매칭 수정). s1554/s1555 는 번역이 영어 "TAT" 유지 — 검토 필요.

## 다음
1. **이탤릭 목적 분류**: 전체 `i:true`(약 2,000개)를 `i:"thought|emphasis|foreign|title|comm|other"` 로 분류(별도 스크립트 예정). reader.css 에 목적별 스타일 준비됨.
2. 문체 일관성 검수: 초기 Opus 청크 ↔ 이후 Sonnet 청크 톤 차이 확인.
3. 남은 말투 검토 항목(Sascha/Cunningham/Chelsea 등) 최종 확정.
4. 와츠 권말 주석(`watts_notes.json`, 144개) 별도 섹션 번역.
