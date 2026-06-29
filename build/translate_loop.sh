#!/usr/bin/env bash
# translate_loop.sh — 사용량 한도로 끊기는 번역을 한도 리셋 후 자동 재개해 끝까지 완료한다.
#
# translate.sh 를 반복 호출한다. 한도에 걸리면 translate.sh 가 즉시(exit 3 → break) 빠지므로
# 한도가 아직 안 풀렸을 때의 재시도는 수 초 만에 끝나 저렴하다. 완료 청크는 -s 가드로 건너뛴다.
#
# 사용:
#   bash build/translate_loop.sh            # 전부 완료될 때까지 자동 반복(시도 간 1시간 대기)
#   WAIT=1800 bash build/translate_loop.sh  # 대기 간격 조정(초)
cd "$(dirname "$0")/.."

WAIT="${WAIT:-3600}"   # 시도 간 대기(초). 한도 리셋 대기용.
TARGET=$(python3 -c "import json;print(len(json.load(open('data/chunks_manifest.json'))))")

attempt=0
while true; do
  attempt=$((attempt+1))
  echo "===== [loop] attempt $attempt — $(date '+%F %T') ====="
  bash build/translate.sh

  n=$(ls data/translations/*.jsonl 2>/dev/null | wc -l)
  echo "===== [loop] 진행: $n/$TARGET 청크 ====="
  if [ "$n" -ge "$TARGET" ]; then
    echo "===== [loop] 전체 완료 — 종료 ====="
    break
  fi
  echo "===== [loop] ${WAIT}s 대기 후 재개(한도 리셋 대기) ====="
  sleep "$WAIT"
done
