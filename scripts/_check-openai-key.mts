import fs from "node:fs";

function load2(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2] ?? "";
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]!]) process.env[m[1]!] = val;
  }
}
load2(".env");
load2(".env.local");
const k = String(process.env.OPENAI_API_KEY || "");
console.log("len", k.length);
console.log("prefix", JSON.stringify(k.slice(0, 7)));
console.log("hasNonAscii", /[^\x00-\xff]/.test(k));
console.log(
  "first12codes",
  [...k.slice(0, 12)].map((c) => c.charCodeAt(0)).join(","),
);
const e = String(process.env.EVOLINK_API_KEY || "");
console.log("evolink len", e.length, "nonAscii", /[^\x00-\xff]/.test(e));
// also check Authorization building
const auth = `Bearer ${k}`;
console.log("authNonAscii", /[^\x00-\xff]/.test(auth), "authLen", auth.length);
