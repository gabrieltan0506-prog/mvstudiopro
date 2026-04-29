FROM node:24.13.1-slim

WORKDIR /app

# 安装 ffmpeg + python3 + yt-dlp + Chromium（PDF 原生渲染，Puppeteer 无 bundled 下载）
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
    ffmpeg python3 python3-pip curl \
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

RUN npm install -g pnpm@10.4.1

COPY . .

# 跳过 postinstall 脚本（youtube-dl-exec 不再自行下载二进制）
# 并告知 youtube-dl-exec 使用系统 yt-dlp
RUN pnpm install --ignore-scripts

# 让 youtube-dl-exec 找到系统 yt-dlp
ENV YOUTUBE_DL_PATH=/usr/local/bin/yt-dlp

# Puppeteer：使用系统 Chromium（禁止下载浏览器二进制，缩短镜像构建）
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Build server code and client assets for production static serving
RUN pnpm build \
 && pnpm exec vite build \
 && rm -rf server/_core/public \
 && mkdir -p server/_core/public \
 && cp -R client/dist/. server/_core/public/

EXPOSE 3000

CMD ["pnpm","exec","tsx","server/_core/index.ts"]
