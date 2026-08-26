#!/usr/bin/env bash
# 清理 growth-cold-store-latest Release 上不再被当前批次清单引用的旧快照分片。
#
# 背景（0826 事故）：每轮冷备都以唯一批次名上传 ~110 个分片，旧批次从不回收，
# Release 撞上 GitHub 每 Release 1000 资产硬上限后所有上传 422，冷备连续标红。
#
# 安全边界：
#   - 只匹配两种批次快照命名（growth-platform-current-complete.batch-*.tar.part-* /
#     platform-current-<平台>.batch-*.part-*）。
#   - archive-* 冷存档是 Fly 端已删数据的唯一副本，永不匹配、永不删除。
#   - 稳定名资产（各清单、bundle、*.json.gz）由 --clobber 原位覆写，不在匹配范围。
#   - 当前清单引用的批次 + 编号最新的一个批次一律保留；清单下载失败则整轮放弃清理
#     （宁可满仓失败，不误删可恢复数据）。
set -euo pipefail

TAG=growth-cold-store-latest
REPO="${GITHUB_REPOSITORY:?需要 GITHUB_REPOSITORY}"
WORK=$(mktemp -d)

if ! release_id=$(gh api "repos/$REPO/releases/tags/$TAG" --jq .id); then
  echo "Release 尚不存在或读取失败，跳过清理"
  exit 0
fi

gh api --paginate "repos/$REPO/releases/$release_id/assets" \
  --jq '.[] | [.id, .name] | @tsv' > "$WORK/assets.tsv"
total=$(wc -l < "$WORK/assets.tsv")
echo "Release 资产总数：$total / 1000"

awk -F'\t' '$2 ~ /^(growth-platform-current-complete|platform-current-[A-Za-z0-9_]+)\.batch-[0-9]+-[0-9]+\.(tar\.)?part-[0-9]+$/' \
  "$WORK/assets.tsv" > "$WORK/batch-assets.tsv"
if [ ! -s "$WORK/batch-assets.tsv" ]; then
  echo "没有批次快照分片，无需清理"
  exit 0
fi

if ! gh release download "$TAG" -p platform-current-batch-manifest.json -D "$WORK" --clobber \
  || [ ! -s "$WORK/platform-current-batch-manifest.json" ]; then
  echo "当前批次清单下载失败，为安全起见本轮不清理"
  exit 0
fi
jq -r '[(.files[]?.parts[]?.assetName), (.bundle.parts[]?.assetName)] | .[]' \
  "$WORK/platform-current-batch-manifest.json" | sort -u > "$WORK/referenced.txt"
if [ ! -s "$WORK/referenced.txt" ]; then
  echo "清单未列出任何分片资产，格式异常，为安全起见本轮不清理"
  exit 0
fi

sed -E 's/^.*\.batch-([0-9]+-[0-9]+)\..*$/\1/' "$WORK/referenced.txt" | sort -u > "$WORK/keep-batches.txt"
sed -E 's/^.*\t.*\.batch-([0-9]+-[0-9]+)\..*$/\1/' "$WORK/batch-assets.tsv" \
  | sort -u -t- -k1,1n -k2,2n | tail -n 1 >> "$WORK/keep-batches.txt"
sort -u "$WORK/keep-batches.txt" -o "$WORK/keep-batches.txt"
echo "保留批次：$(paste -sd ' ' "$WORK/keep-batches.txt")"

deleted=0
while IFS=$'\t' read -r asset_id asset_name; do
  batch=$(sed -E 's/^.*\.batch-([0-9]+-[0-9]+)\..*$/\1/' <<< "$asset_name")
  if grep -qxF "$batch" "$WORK/keep-batches.txt"; then
    continue
  fi
  if gh api -X DELETE "repos/$REPO/releases/assets/$asset_id" >/dev/null; then
    deleted=$((deleted + 1))
  else
    echo "删除失败（跳过继续）：$asset_name"
  fi
done < "$WORK/batch-assets.tsv"

remaining=$((total - deleted))
echo "已清理旧批次分片：$deleted 个，Release 剩余约 $remaining / 1000"
if [ "$remaining" -gt 800 ]; then
  echo "::warning::growth-cold-store-latest 资产已达 $remaining/1000，多为 archive-* 冷存档；需要把冷存档轮转到按月 Release，否则将再次撞上限"
fi
