FROM node:24.13.1-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install --no-install-recommends -y ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.4.1

COPY . .

RUN pnpm install

# 编译 TypeScript
RUN pnpm build

EXPOSE 3000

CMD ["node","dist/server/_core/index.js"]
