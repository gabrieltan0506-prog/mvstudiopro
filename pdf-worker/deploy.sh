#!/bin/bash
# 🤖 此脚本是手动兜底 — 正常路径请走 GitHub Actions 自动部署：
#   .github/workflows/pdf-worker-deploy.yml
# 触发：main 分支 pdf-worker/ 目录任意改动 push 即自动 build + deploy。
#
# 使用本脚本的场景：
#   1. CI workflow 临时挂掉
#   2. 本地 hotfix 想立即上线，不等 PR merge
#   3. 首次部署初始化（IAM、bucket 等）
#
# 改本脚本资源配置时，记得同步改 .github/workflows/pdf-worker-deploy.yml 的
# `gcloud run deploy` 步骤。
set -e

# 强制 cd 到本脚本所在目录，不然 gcloud builds submit 会把整个 mvstudiopro
# 仓库（~160 MiB）当 build context 上传 + 用错 Dockerfile（主仓 Dockerfile）。
cd "$(dirname "$0")"

PROJECT_ID="mv-studio-pro"
PROJECT_NUM="255451353515"
REGION="us-central1"
SERVICE_NAME="pdf-service"
SA_NAME="pdf-runner"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BUCKET_NAME="gs://${PROJECT_ID}-build-stash-${PROJECT_NUM}"
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME}"

echo "🚀 [1/5] 正在建立專屬的服務帳號 (Service Account)..."
gcloud iam service-accounts create $SA_NAME --display-name="PDF Runner SA" 2>/dev/null || echo "✅ 帳號已存在"

echo "🔐 [2/5] 正在綁定必要權限..."
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA_EMAIL" --role="roles/storage.admin" >/dev/null
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA_EMAIL" --role="roles/logging.logWriter" >/dev/null
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA_EMAIL" --role="roles/cloudbuild.builds.builder" >/dev/null
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA_EMAIL" --role="roles/artifactregistry.writer" >/dev/null
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA_EMAIL" --role="roles/run.admin" >/dev/null
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA_EMAIL" --role="roles/iam.serviceAccountUser" >/dev/null

echo "📦 [3/5] 正在建立絕對不撞名的雲端打包置物櫃..."
gcloud storage buckets create $BUCKET_NAME --location=$REGION 2>/dev/null || echo "✅ 置物櫃已存在"

echo "🛠️ [4/5] 正在將代碼送往雲端打包 (請耐心等待 3~5 分鐘)..."
gcloud builds submit --tag $IMAGE_URL \
  --gcs-source-staging-dir="${BUCKET_NAME}/source" \
  --service-account="projects/${PROJECT_ID}/serviceAccounts/${SA_EMAIL}" \
  --gcs-log-dir="${BUCKET_NAME}/logs"

echo "🛸 [5/5] 正在發射至 Cloud Run..."
# Deep Research Max：setContent + 等图 + page.pdf + gs 连续阶段可能 > 33min；拉满 Cloud Run HTTP 上限 3600s。
# 须与 pdf-worker/index.ts express server socket、server/routers.ts PDF_PROXY_FETCH_TIMEOUT_MS、fly.toml idle_timeout 一起改。
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_URL \
  --region $REGION \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 4 \
  --timeout=3600 \
  --service-account=$SA_EMAIL

echo "🎉 部署腳本執行完畢！"
