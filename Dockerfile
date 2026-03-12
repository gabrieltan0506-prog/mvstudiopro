FROM node:24.13.1-slim

WORKDIR /app

RUN npm install -g pnpm@10.4.1

COPY . .

RUN pnpm install

# 编译 TypeScript
RUN pnpm build

EXPOSE 3000

CMD ["node","dist/server/_core/index.js"]
