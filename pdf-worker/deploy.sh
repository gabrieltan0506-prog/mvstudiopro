#!/bin/bash
set -e

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
# 2026-05-01 用户决策：Deep Research Max 16-25 MB HTML 已成常态，资源上调
#   --timeout=600 → 2000 (33 min) — Gemini reviewer 建议拉到 2000s，
#       给 PDF 序列化 + 跨云回传 500s 缓冲（page.setContent 1500s 之外）
#   --memory 2Gi → 4Gi — 16-25 MB HTML 在 DOM 里展开 3-5x，2GB 紧张
#   --cpu 2 → 4 — 提速 puppeteer 渲染 + 字体落地
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_URL \
  --region $REGION \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 4 \
  --timeout=2000 \
  --service-account=$SA_EMAIL

echo "🎉 部署腳本執行完畢！"
