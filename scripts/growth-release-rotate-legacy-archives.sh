#!/usr/bin/env bash
# 旧冷备 Release 的存量归档轮转（0912）。
#
# 背景：#1443 之后**新**归档已按 scripts/growth-release-tag.mjs 分仓到
# growth-archive-YYYY-MM-DD，但 growth-cold-store-latest 里还压着约 967 个
# 存量 archive-*（Fly 已删数据的唯一副本），把 1000 附件上限占死，
# 任何新名字资产上传都 422，冷备连红。
#
# 本脚本把存量归档搬回它们本该在的日仓：
#   小件优先 → 从旧仓下载 → 校验字节数 → 传入目标日仓 → 回读验真（字节+SHA256）
#   → 全部对上才删旧仓那份。任何一步不对就跳过并保留旧仓副本，绝不先删后传。
# 读取端（shared/growthColdStoreRelease.mjs fetchGrowthColdStoreAsset）本就
# 先读日仓、404 才回落旧仓，搬前搬后按名恢复都成立。
#
# 只动名字能被 growth-release-tag.mjs 路由到非旧仓的资产；
# 固定名资产（growth-platforms.tar.gz / *.json.gz 等 33 个）永不在范围内。
set -euo pipefail

TAG=growth-cold-store-latest
LIMIT=1000
REPO="${GITHUB_REPOSITORY:?需要 GITHUB_REPOSITORY}"
# 旧仓余量补到这个数就停；每轮最多搬这么多个、花这么多秒
TARGET_FREE="${GROWTH_ROTATE_TARGET_FREE:-200}"
MAX_MOVES="${GROWTH_ROTATE_MAX_MOVES:-80}"
TIME_BUDGET_S="${GROWTH_ROTATE_TIME_BUDGET_S:-720}"
DRY_RUN="${GROWTH_ROTATE_DRY_RUN:-0}"

WORK=$(mktemp -d /tmp/growth-rotate.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

release_id=$(gh api "repos/$REPO/releases/tags/$TAG" --jq .id)
gh api --paginate "repos/$REPO/releases/$release_id/assets" \
  --jq '.[] | [.id, .name, .size] | @tsv' > "$WORK/assets.tsv"
used=$(wc -l < "$WORK/assets.tsv" | tr -d " ")
free=$((LIMIT - used))
need=$((TARGET_FREE - free))
echo "旧仓占用 ${used}/${LIMIT}（余量 ${free}），目标余量 ${TARGET_FREE}"
if [ "$need" -le 0 ]; then
  echo "余量已达标，无需轮转"
  exit 0
fi

# 一次 node 过程算出全部路由（判据收口在 shared/growthColdStoreRelease.mjs，不在 bash 里重写正则）
cut -f2 "$WORK/assets.tsv" | node --input-type=module -e '
import { growthColdStoreReleaseTag } from "./shared/growthColdStoreRelease.mjs";
import fs from "node:fs";
const lines = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
for (const name of lines) {
  let tag = "";
  try { tag = growthColdStoreReleaseTag(name); } catch { tag = ""; }
  console.log(tag);
}' > "$WORK/tags.txt"
test "$(wc -l < "$WORK/tags.txt" | tr -d " ")" -eq "$used"

# movable.tsv: size \t id \t name \t target_tag（小件优先，同样的时间预算多腾位置）
paste "$WORK/assets.tsv" "$WORK/tags.txt" \
  | awk -F'\t' -v tag="$TAG" '$4 != "" && $4 != tag { print $3 "\t" $1 "\t" $2 "\t" $4 }' \
  | sort -n > "$WORK/movable.tsv"
movable=$(wc -l < "$WORK/movable.tsv" | tr -d " ")
echo "可轮转存量归档：${movable} 个；本轮至多搬 ${MAX_MOVES} 个 / ${TIME_BUDGET_S} 秒 / 补足 ${need} 个"
if [ "$movable" -eq 0 ]; then
  echo "::warning::旧仓已无可轮转的归档资产，余量只能靠人工处理固定名资产"
  exit 0
fi
if [ "$DRY_RUN" = "1" ]; then
  head -5 "$WORK/movable.tsv" | awk -F'\t' '{printf "DRY RUN 将搬：%s (%s bytes) -> %s\n", $3, $1, $4}'
  exit 0
fi

sha_of() { sha256sum "$1" | awk '{print $1}'; }

download_exact() { # $1=tag $2=name $3=dir → 0 且文件存在；不存在返回 1
  local tag="$1" name="$2" dir="$3"
  rm -f "$dir/$name"
  mkdir -p "$dir"
  gh release download "$tag" -p "$name" -D "$dir" --clobber 2>/dev/null || true
  [ -f "$dir/$name" ]
}

deadline=$((SECONDS + TIME_BUDGET_S))
moved=0
skipped=0
while IFS=$'\t' read -r size asset_id name target_tag; do
  [ "$moved" -ge "$MAX_MOVES" ] && break
  [ "$need" -le 0 ] && break
  [ "$SECONDS" -ge "$deadline" ] && { echo "时间预算用尽，本轮到此"; break; }
  case "$name" in ""|.|..|*[!0-9A-Za-z._-]*) echo "::warning::非法资产名跳过：$name"; skipped=$((skipped+1)); continue ;; esac

  if ! download_exact "$TAG" "$name" "$WORK/dl"; then
    echo "::warning::下载失败，保留旧仓副本：$name"
    skipped=$((skipped+1)); continue
  fi
  actual_bytes=$(stat -c%s "$WORK/dl/$name" 2>/dev/null || stat -f%z "$WORK/dl/$name")
  if [ "$actual_bytes" != "$size" ]; then
    echo "::warning::下载字节数不符（${actual_bytes} != ${size}），保留旧仓副本：$name"
    rm -f "$WORK/dl/$name"; skipped=$((skipped+1)); continue
  fi
  expected_sha=$(sha_of "$WORK/dl/$name")

  if ! gh release view "$target_tag" >/dev/null 2>&1; then
    gh release create "$target_tag" ${GITHUB_SHA:+--target "$GITHUB_SHA"} --latest=false \
      --title "$target_tag" --notes "Growth 冷备分仓；由旧仓存量轮转而来" || {
        echo "::warning::目标仓创建失败，保留旧仓副本：$name"; skipped=$((skipped+1)); continue
      }
  fi

  VERIFIED=false
  if download_exact "$target_tag" "$name" "$WORK/tv"; then
    # 目标仓已有同名：SHA 相同视为重复副本，直接清旧仓；不同则人工看，绝不覆盖
    if [ "$(sha_of "$WORK/tv/$name")" = "$expected_sha" ]; then
      VERIFIED=true
    else
      echo "::warning::目标仓已有同名但内容不同，跳过并保留两份：$name @ $target_tag"
      rm -f "$WORK/dl/$name" "$WORK/tv/$name"; skipped=$((skipped+1)); continue
    fi
  else
    for attempt in 1 2 3; do
      if gh release upload "$target_tag" "$WORK/dl/$name#$name" --clobber \
        && download_exact "$target_tag" "$name" "$WORK/tv" \
        && [ "$(stat -c%s "$WORK/tv/$name" 2>/dev/null || stat -f%z "$WORK/tv/$name")" = "$size" ] \
        && [ "$(sha_of "$WORK/tv/$name")" = "$expected_sha" ]; then
        VERIFIED=true
        break
      fi
      echo "上传/回读重试：$name -> $target_tag（${attempt}/3）"
      sleep 15
    done
  fi
  if [ "$VERIFIED" != "true" ]; then
    echo "::warning::回读验真未通过，保留旧仓副本：$name"
    rm -f "$WORK/dl/$name" "$WORK/tv/$name"; skipped=$((skipped+1)); continue
  fi

  gh api -X DELETE "repos/$REPO/releases/assets/$asset_id" >/dev/null
  moved=$((moved + 1))
  need=$((need - 1))
  echo "已轮转（${moved}）：$name -> $target_tag（${size} bytes，旧仓副本已删）"
  rm -f "$WORK/dl/$name" "$WORK/tv/$name"
done < "$WORK/movable.tsv"

echo "本轮轮转完成：搬走 ${moved} 个，跳过 ${skipped} 个"
