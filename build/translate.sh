#!/usr/bin/env bash
# translate.sh — 청크를 순회하며 번역(재개 가능, 청크별 에러 격리).
#
# 각 청크는 translate_split.py 가 작은 배치(기본 10 segment)로 나눠 claude -p 를 호출한다.
# 큰 청크를 한 번에 번역하면 응답이 끝맺지 못하고 폭주(장시간/출력토큰초과)하므로 배치로 쪼갠다.
#
# 사용:
#   bash build/translate.sh                 # 미번역 청크 전부
#   bash build/translate.sh s0149-s0181     # 특정 청크만
#   BATCH=8 bash build/translate.sh         # 배치 크기 조정(기본 10)
#   MODEL=opus bash build/translate.sh      # 번역 모델 변경(기본 sonnet)
#
# 인증: 같은 폴더의 CLAUDE_CODE_OAUTH_TOKEN 파일이 있으면 자동 로드(translate_split.py 도 동일).
# 주의: set -e 를 쓰지 않는다. 한 청크가 실패해도 다음으로 계속 진행한다.
cd "$(dirname "$0")/.."

DATA="data"
mkdir -p "$DATA/translations" "$DATA/.work"

if [ -f CLAUDE_CODE_OAUTH_TOKEN ]; then
  export CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '\r\n' < CLAUDE_CODE_OAUTH_TOKEN)"
fi

if [ "$#" -gt 0 ]; then
  CHUNKS=("$@")
else
  CHUNKS=($(python3 -c "import json;print(' '.join(m['chunk_id'] for m in json.load(open('$DATA/chunks_manifest.json'))))"))
fi

ok=0; failed=0; skipped=0
for cid in "${CHUNKS[@]}"; do
  out="$DATA/translations/$cid.jsonl"
  # -s : 파일이 존재하고 비어 있지 않을 때만 건너뜀(0바이트/부분 파일은 재번역)
  if [ -s "$out" ]; then echo "skip $cid (이미 번역됨)"; skipped=$((skipped+1)); continue; fi

  echo "translating $cid ..."
  # translate_split.py 가 배치 분할·연속성·parse_result 저장까지 처리(배치별 .work 캐시로 재개).
  python3 build/translate_split.py "$cid" "${BATCH:-10}"
  code=$?
  if [ "$code" -eq 0 ]; then
    ok=$((ok+1))
  elif [ "$code" -eq 3 ]; then
    # 사용량/한도 도달: 남은 청크도 모두 실패할 것이므로 전체 중단(재개는 한도 리셋 후 재실행).
    echo "  ! 사용량 한도 도달 — 중단. 한도 리셋 후 'bash build/translate.sh' 재실행으로 이어서."
    break
  else
    echo "  x $cid 번역 실패(다음 청크 계속)"; failed=$((failed+1))
  fi
done

echo "done. 번역 $ok / 건너뜀 $skipped / 실패 $failed"
