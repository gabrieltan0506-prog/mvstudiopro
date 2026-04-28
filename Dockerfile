FROM node:24.13.1-slim

WORKDIR /app

# 安装 ffmpeg + python3 + yt-dlp（系统级，绕过 npm postinstall 下载）
RUN apt-get update \
 && apt-get install --no-install-recommends -y ffmpeg python3 python3-pip curl \
 && pip3 install --break-system-packages yt-dlp \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.4.1

COPY . .

# 跳过 postinstall 脚本（youtube-dl-exec 不再自行下载二进制）
# 并告知 youtube-dl-exec 使用系统 yt-dlp
RUN pnpm install --ignore-scripts

# 让 youtube-dl-exec 找到系统 yt-dlp
ENV YOUTUBE_DL_PATH=/usr/local/bin/yt-dlp

# Build server code and client assets for production static serving
RUN pnpm build \
 && pnpm exec vite build \
 && rm -rf server/_core/public \
 && mkdir -p server/_core/public \
 && cp -R client/dist/. server/_core/public/

EXPOSE 3000

CMD ["pnpm","exec","tsx","server/_core/index.ts"]
