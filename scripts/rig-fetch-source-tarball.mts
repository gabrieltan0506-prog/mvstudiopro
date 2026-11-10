// 在 Fly 工作机内读取 Actions 上传到 GCS 的提交源码包（替代 codeload 匿名下载）。
// 用法（在 Fly 内）：npx tsx scripts/rig-fetch-source-tarball.mts <40位sha|分支名> <输出.tar.gz>
// 凭证：复用服务端已有的 GCS 访问（server/services/gcs.ts），不在本机配置任何密钥。
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { downloadGcsObject } from "../server/services/gcs.js";

const [target, outPath] = process.argv.slice(2);
if (!target || !outPath) throw new Error("用法：rig-fetch-source-tarball.mts <sha|分支名> <输出.tar.gz>");

const bucket = String(process.env.SOURCE_TARBALL_GCS_BUCKET || "mv-studio-pro-build-stash-255451353515").trim();
const prefix = `gs://${bucket}/mvstudiopro-source`;

let sha = target;
if (!/^[0-9a-f]{40}$/.test(target)) {
  const refKey = target.replace(/[^A-Za-z0-9._-]/g, "-");
  sha = (await downloadGcsObject({ gcsUri: `${prefix}/refs/${refKey}.txt` })).buffer.toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`源码指针内容非法：${refKey}`);
}

const [tarball, expected] = await Promise.all([
  downloadGcsObject({ gcsUri: `${prefix}/${sha}.tar.gz` }),
  downloadGcsObject({ gcsUri: `${prefix}/${sha}.tar.gz.sha256` }),
]);
const actual = createHash("sha256").update(tarball.buffer).digest("hex");
if (actual !== expected.buffer.toString("utf8").trim()) throw new Error(`源码包摘要不符：${sha}`);
await fs.writeFile(outPath, tarball.buffer, { flag: "wx" });
console.log(JSON.stringify({ sha, outPath, bytes: tarball.buffer.length, sha256: actual }));
