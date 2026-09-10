# 内部专用 Suno cookie 桥（gcui-art/suno-api，钉死上游提交）。
# 只走 Fly 6PN 内网，不开公网端口；模型代号由主站每次请求带 `model` 字段传入，不改上游默认值。
# 违反 Suno 条款、可能封号：只给内部账号用，不接付费用户（知识库《配乐间与Suno接入》0910 补录）。
FROM node:lts-bookworm AS build
ARG SUNO_API_COMMIT=a2e6a823428903af715d3835d1cb44ffa336021d
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone https://github.com/gcui-art/suno-api.git . && git checkout ${SUNO_API_COMMIT}
RUN npm ci
RUN npm run build

FROM node:lts-bookworm
ENV NODE_ENV=production \
    BROWSER=chromium \
    BROWSER_HEADLESS=true \
    BROWSER_GHOST_CURSOR=false \
    BROWSER_LOCALE=en \
    BROWSER_DISABLE_GPU=true \
    PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libxshmfence1 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/package*.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/.next ./.next
COPY --from=build /src/public ./public
COPY --from=build /src/next.config.* ./
RUN npx playwright install chromium
EXPOSE 3000
CMD ["npm", "run", "start"]
