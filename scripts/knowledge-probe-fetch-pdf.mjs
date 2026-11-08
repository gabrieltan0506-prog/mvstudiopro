// 在工作机内按正式导出回执里的签名地址取回成品PDF到探针目录；不打印地址。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const dir = process.argv[2];
if (existsSync(`${dir}/handbook.pdf`)) { console.log(JSON.stringify({ pdf: "exists" })); process.exit(0); }
if (!existsSync(`${dir}/export-response.json`)) { console.log(JSON.stringify({ pdf: "no-export-response" })); process.exit(0); }
const text = readFileSync(`${dir}/export-response.json`, "utf8");
const url = text.match(/"pdfUrl":"(https:[^"]+)"/)?.[1];
if (!url) { console.log(JSON.stringify({ pdf: "no-url" })); process.exit(0); }
const response = await fetch(url.replace(/\\u0026/g, "&"));
if (!response.ok) { console.log(JSON.stringify({ pdf: "fetch-failed", status: response.status })); process.exit(0); }
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.subarray(0, 4).toString() !== "%PDF") { console.log(JSON.stringify({ pdf: "not-pdf" })); process.exit(0); }
writeFileSync(`${dir}/handbook.pdf`, bytes);
console.log(JSON.stringify({ pdf: "saved", bytes: bytes.length }));
