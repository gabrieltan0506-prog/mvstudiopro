/**
 * 批量将 client/src、shared 下 .ts/.tsx 中台湾繁体用字转为大陆简体（不删档；仅覆盖有变化的文件）。
 * 用法：node scripts/tw2s-batch.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as OpenCC from "opencc-js";

const converter = OpenCC.Converter({ from: "tw", to: "cn" });

function walkTs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(p, acc);
    else if (/\.(ts|tsx)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

let changed = 0;
let total = 0;
for (const root of ["client/src", "shared"]) {
  for (const f of walkTs(root)) {
    total++;
    const src = fs.readFileSync(f, "utf8");
    const out = converter(src);
    if (out !== src) {
      fs.writeFileSync(f, out, "utf8");
      changed++;
    }
  }
}
console.log(`tw2s: scanned ${total} files, rewritten ${changed}.`);
