// 公开仓库下的探针私有文件传输：RSA-OAEP 包裹随机 AES-256-GCM 密钥。
// keygen <私钥路径>：在工作机生成私钥（不离机），只输出公钥。
// encrypt <公钥PEM文件> <输入> <输出前缀>：生成 <前缀>.enc 与 <前缀>.key。
// decrypt <私钥路径> <前缀> <输出>：还原文件。
import { generateKeyPairSync, publicEncrypt, privateDecrypt, randomBytes, createCipheriv, createDecipheriv, constants } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
const [cmd, a, b, c] = process.argv.slice(2);
const oaep = key => ({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" });
if (cmd === "keygen") {
  if (!existsSync(a)) {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096 });
    writeFileSync(a, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(a, 0o600);
  }
  const { createPrivateKey, createPublicKey } = await import("node:crypto");
  console.log(createPublicKey(createPrivateKey(readFileSync(a))).export({ type: "spki", format: "pem" }));
} else if (cmd === "encrypt") {
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(readFileSync(b)), cipher.final()]);
  writeFileSync(`${c}.enc`, Buffer.concat([iv, cipher.getAuthTag(), body]));
  writeFileSync(`${c}.key`, publicEncrypt(oaep(readFileSync(a)), key));
} else if (cmd === "decrypt") {
  const key = privateDecrypt(oaep(readFileSync(a)), readFileSync(`${b}.key`));
  const data = readFileSync(`${b}.enc`);
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  writeFileSync(c, Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]));
  console.log(JSON.stringify({ decrypted: c, bytes: readFileSync(c).length }));
} else throw Error("用法：keygen|encrypt|decrypt");
