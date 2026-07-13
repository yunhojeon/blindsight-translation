#!/usr/bin/env bash
# review.sh — 청크를 순회하며 번역 품질+이탤릭 용도를 감수(재개 가능, 청크별 에러 격리).
#
# 각 청크는 review_chunk.py 가 (id+원문+번역) 평문을 claude -p 로 감수하고,
# 문제/오분류 문장만 받아 translations/<cid>.jsonl 에 반영한다(원본은 review_backup/ 보존).
#
# 사용:
#   bash build/review.sh                  # 미감수 청크 전부
#   bash build/review.sh s0001-s0047      # 특정 청크만
#   MODEL=opus bash build/review.sh       # 감수 모델 변경(기본 sonnet)
#   DRY=1 bash build/review.sh s0001-s0047 # 적용 없이 요약만(드라이런)
#
# 인증: 같은 폴더의 CLAUDE_CODE_OAUTH_TOKEN 파일이 있으면 자동 로드.
# 주의: set -e 를 쓰지 않는다. 한 청크가 실패해도 다음으로 계속 진행한다.
cd "$(dirname "$0")/.."

DATA="data"
mkdir -p "$DATA/.work" "$DATA/review_backup"

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
  # .reviewed 표식이 있으면 이미 감수됨(DRY 실행은 표식을 남기지 않으므로 재실행 가능)
  if [ -z "$DRY" ] && [ -f "$DATA/.work/$cid.reviewed" ]; then
    echo "skip $cid (이미 감수됨)"; skipped=$((skipped+1)); continue
  fi

  echo "reviewing $cid ..."
  python3 build/review_chunk.py "$cid"
  code=$?
  if [ "$code" -eq 0 ]; then
    ok=$((ok+1))
  elif [ "$code" -eq 3 ]; then
    echo "  ! 사용량 한도 도달 — 중단. 한도 리셋 후 'bash build/review.sh' 재실행으로 이어서."
    break
  else
    echo "  x $cid 감수 실패(다음 청크 계속)"; failed=$((failed+1))
  fi
done

echo "done. 감수 $ok / 건너뜀 $skipped / 실패 $failed"
