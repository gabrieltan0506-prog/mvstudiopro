FROM node:24.13.1-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install --no-install-recommends -y ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.4.1

COPY . .

RUN pnpm install

# Build server code and client assets for production static serving
RUN pnpm build \
 && pnpm exec vite build \
 && rm -rf server/_core/public \
 && mkdir -p server/_core/public \
 && cp -R client/dist/. server/_core/public/

EXPOSE 3000

CMD ["pnpm","exec","tsx","server/_core/index.ts"]
