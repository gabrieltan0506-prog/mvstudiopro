// 打包隔离探针：服务端入口与租约包装器（依赖沿用工作机 /app/node_modules），以及正式出版面板前端。
import { build } from "esbuild";
const [entry, outDir] = process.argv.slice(2);
if (!entry || !outDir) throw Error("用法：node scripts/build-knowledge-probe.mjs <entry.mts> <outDir>");
const banner = { js: "import{createRequire as __probeCreateRequire}from'module';const require=__probeCreateRequire(import.meta.url);" };
const node = { bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", banner, tsconfig: "tsconfig.json", logLevel: "warning" };
await build({ ...node, entryPoints: [entry], outfile: `${outDir}/entry.mjs` });
await build({ ...node, entryPoints: ["scripts/with-worker-probe-lease.mts"], outfile: `${outDir}/lease.mjs` });
await build({ entryPoints: ["scripts/probe-knowledge-handbook-panel.tsx"], outfile: `${outDir}/panel.js`, bundle: true, platform: "browser", format: "iife", jsx: "automatic", target: "es2020", tsconfig: "tsconfig.json", logLevel: "warning",
  define: { "import.meta.env": JSON.stringify({ MODE: "production", DEV: false, PROD: true, SSR: false, BASE_URL: "/" }), "process.env.NODE_ENV": '"production"' } });
console.log("built", outDir);
