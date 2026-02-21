import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Font timeout patch", () => {
  const expoFontLoaderPath = path.join(
    __dirname,
    "../../node_modules/expo-font/build/ExpoFontLoader.web.js"
  );

  it("ExpoFontLoader.web.js exists", () => {
    expect(fs.existsSync(expoFontLoaderPath)).toBe(true);
  });

  it("font timeout is patched to 30000ms (not 6000ms)", () => {
    const content = fs.readFileSync(expoFontLoaderPath, "utf8");
    expect(content).toContain(".load(null, 30000)");
    expect(content).not.toContain(".load(null, 6000)");
  });

  it("patch script exists and is executable", () => {
    const patchScript = path.join(__dirname, "../../scripts/patch-font-timeout.js");
    expect(fs.existsSync(patchScript)).toBe(true);
  });

  it("postinstall hook is configured in package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8")
    );
    expect(pkg.scripts.postinstall).toContain("patch-font-timeout");
  });

  it("web-font-preload module exists", () => {
    const preloadPath = path.join(__dirname, "../../lib/web-font-preload.ts");
    expect(fs.existsSync(preloadPath)).toBe(true);
    const content = fs.readFileSync(preloadPath, "utf8");
    expect(content).toContain("timeout exceeded");
    expect(content).toContain("initWebFontPreload");
  });

  it("_layout.tsx imports and calls initWebFontPreload", () => {
    const layoutPath = path.join(__dirname, "../../app/_layout.tsx");
    const content = fs.readFileSync(layoutPath, "utf8");
    expect(content).toContain("initWebFontPreload");
    expect(content).toContain("web-font-preload");
  });
});
