/**
 * Patch expo-font's ExpoFontLoader.web.js to increase font loading timeout
 * from 6000ms to 30000ms, preventing fontfaceobserver timeout errors on slow networks.
 *
 * This script runs as a postinstall hook so the patch survives `pnpm install`.
 */
const fs = require("fs");
const path = require("path");

const targetFile = path.join(
  __dirname,
  "..",
  "node_modules",
  "expo-font",
  "build",
  "ExpoFontLoader.web.js"
);

try {
  if (!fs.existsSync(targetFile)) {
    console.log("[patch-font-timeout] Target file not found, skipping.");
    process.exit(0);
  }

  let content = fs.readFileSync(targetFile, "utf8");

  // Patch 1: Change the FontObserver .load() timeout from 6000 to 30000
  const oldPattern = ".load(null, 6000)";
  const newPattern = ".load(null, 30000)";

  if (content.includes(oldPattern)) {
    content = content.replace(oldPattern, newPattern);
    fs.writeFileSync(targetFile, content, "utf8");
    console.log("[patch-font-timeout] ✅ Patched font timeout: 6000ms → 30000ms");
  } else if (content.includes(newPattern)) {
    console.log("[patch-font-timeout] Already patched, skipping.");
  } else {
    console.log("[patch-font-timeout] Pattern not found, file may have changed.");
  }
} catch (err) {
  console.error("[patch-font-timeout] Error:", err.message);
  // Non-fatal: don't break install
  process.exit(0);
}
