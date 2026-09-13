FROM node:24.13.1-slim

WORKDIR /app

# 安装 ffmpeg + python3 + yt-dlp + Chromium（PDF 原生渲染，Puppeteer 无 bundled 下载）
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
    ffmpeg python3 python3-pip python3-numpy curl \
    blender xvfb xauth libgl1-mesa-dri \
    unzip binutils poppler-utils \
    chromium \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libgbm1 \
 && pip3 install --break-system-packages yt-dlp \
 && rm -rf /var/lib/apt/lists/*

# 白模由确定性脚本在无显示服务器上渲染；使用软件 GL，不要求生产 GPU。
RUN blender --background --factory-startup --version \
 && blender --background --factory-startup --python-exit-code 1 \
    --python-expr "import numpy; import io_scene_gltf2.blender.imp.gltf2_blender_mesh; print('GLTF_DEPENDENCIES_IMPORTED', numpy.__version__)" \
 && command -v xvfb-run
ENV LIBGL_ALWAYS_SOFTWARE=1

RUN npm install -g pnpm@10.4.1

# Fly remote builders 可能長期命中舊的 COPY 快取（建置上下文未變更 checksum 時仍用舊原始碼）。
# 透過 fly.toml [build.args].CACHEBUST 手動遞增，可強制重新 COPY 與後續 RUN。
ARG CACHEBUST=0
RUN test -n "${CACHEBUST:-}" && echo "CACHEBUST=${CACHEBUST}"

COPY . .

# 依赖导入成功不代表旧版 glTF 插件能运行；必须真实导出并经生产入口重新导入带骨/表情 GLB。
# 离线自造夹具，不联网、不渲染视频；同时验证拒绝路径、蒙皮、动作与表演数据。
RUN blender --background --factory-startup --python-exit-code 1 \
    --python server/scripts/test_previs_rigged_model.py -- /tmp/previs-gltf-build-smoke

# 跳过 postinstall 脚本（youtube-dl-exec 不再自行下载二进制）
# 并告知 youtube-dl-exec 使用系统 yt-dlp
RUN pnpm install --ignore-scripts

# 让 youtube-dl-exec 找到系统 yt-dlp
ENV YOUTUBE_DL_PATH=/usr/local/bin/yt-dlp

# Puppeteer：使用系统 Chromium（禁止下载浏览器二进制，缩短镜像构建）
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 构建阶段必须显式给TypeScript足够堆空间；下方运行时ENV不会追溯影响此RUN。
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm build \
 && pnpm exec vite build \
 && rm -rf server/_core/public \
 && mkdir -p server/_core/public \
 && cp -R client/dist/. server/_core/public/

EXPOSE 3000

# Fly / 容器內必須監聽 0.0.0.0；PORT 與 fly.toml internal_port / 健康檢查一致
# 與 fly.toml 10GB VM 對齊（8GB 堆）；Fly 部署時以 fly.toml [env] / Secrets 為準
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_OPTIONS=--max-old-space-size=8192

CMD ["pnpm","exec","tsx","server/_core/index.ts"]
