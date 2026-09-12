#!/usr/bin/env bash
# 冷备发布前的容量闸门（0911）。
#
# 背景：growth-cold-store-latest 撞上 GitHub「每 Release 1000 个附件」硬上限后，
# 所有上传返回 HTTP 422 Validation Failed，冷备连红四班，日志里只有一句 422，
# 看不出是容量问题。#1443 已把批次分片与归档改走独立 Release，但这个旧 Release
# 仍然收固定名资产（--clobber 原位覆写，不涨数量），headroom 恰好是 0：
# 只要出现一个**新名字**（例如新增一个平台的 json.gz），又会 422。
#
# 本脚本做两件事：
#   1) 报出真实占用，把「神秘 422」变成看得懂的容量数字；
#   2) 余量不足时回收**已被新分仓取代**的旧批次分片（archive-* 冷存档永不匹配、永不删），
#      回收后仍无余量就明确失败，并说清该怎么办。
set -euo pipefail

TAG=growth-cold-store-latest
REPO="${GITHUB_REPOSITORY:?需要 GITHUB_REPOSITORY}"
LIMIT=1000
# 低于这个余量就先回收一次；再低于 MIN_FREE 就判失败
WANT_FREE="${GROWTH_RELEASE_WANT_FREE:-20}"
MIN_FREE="${GROWTH_RELEASE_MIN_FREE:-1}"

count_assets() {
  gh api --paginate "repos/$REPO/releases/tags/$TAG" --jq '.assets | length' 2>/dev/null \
    | awk '{s+=$1} END {print s+0}'
}

if ! gh api "repos/$REPO/releases/tags/$TAG" >/dev/null 2>&1; then
  echo "旧 Release 尚不存在，无需容量闸门"
  exit 0
fi

used=$(count_assets)
free=$((LIMIT - used))
echo "冷备旧 Release 占用：${used}/${LIMIT}（余量 ${free}）"

if [ "$free" -lt "$WANT_FREE" ]; then
  echo "余量不足 ${WANT_FREE}，先回收已被分仓取代的旧批次分片"
  bash scripts/prune-growth-release-batch-assets.sh || echo "::warning::回收未完成，继续按现有余量判断"
  used=$(count_assets)
  free=$((LIMIT - used))
  echo "回收后占用：${used}/${LIMIT}（余量 ${free}）"
fi

# 0912：回收后仍不宽裕就轮转存量归档到日仓（验真后才删旧仓，见脚本头注释）。
# 每轮限时限量，随每 3 小时的冷备逐步把余量补到 GROWTH_ROTATE_TARGET_FREE。
if [ "$free" -lt "$WANT_FREE" ] || [ "$free" -lt "${GROWTH_ROTATE_TARGET_FREE:-200}" ]; then
  bash scripts/growth-release-rotate-legacy-archives.sh     || echo "::warning::存量归档轮转未完成，继续按现有余量判断"
  used=$(count_assets)
  free=$((LIMIT - used))
  echo "轮转后占用：${used}/${LIMIT}（余量 ${free}）"
fi

if [ "$free" -lt "$MIN_FREE" ]; then
  echo "::error::冷备旧 Release 已满（${used}/${LIMIT}），新增资产会被 GitHub 以 HTTP 422 拒绝。" >&2
  echo "::error::批次分片回收与存量归档轮转都没能腾出位置（轮转日志见上）。" >&2
  echo "::error::请查看轮转 warning 的具体资产；固定名资产迁仓需人工拍板。" >&2
  exit 1
fi
echo "容量足够，继续发布"
