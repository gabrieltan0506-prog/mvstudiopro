import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    /**
     * 0919 第二轮探针实锤：`client/src/lib/*.browser.test.ts`（17 个离线 puppeteer 夹具）
     * 的 `afterAll` 里 `browser.close()` 在有负载时会超过默认 10s，于是**测试本身全绿、
     * 红的是 hook** —— 判据不稳，跟功能没关系，而且单独跑一个文件也会红，不只全量跑。
     * beforeAll 各自写了 180s，afterAll 没处写，所以在这里统一给 hook 兜底。
     */
    hookTimeout: 180_000,
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/lib/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
  },
});
