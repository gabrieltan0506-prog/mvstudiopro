import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("监管密钥传输收口", () => {
  it("tRPC schema 与业务调用不再携带 supervisorToken", async () => {
    const root = process.cwd();
    const serverRouters = await fs.readFile(path.join(root, "server/routers.ts"), "utf8");
    const withoutLegacyJobSanitizer = serverRouters.replace(
      /const \{ supervisorToken: _\w+, \.\.\.\w+ \} = \w+;/g,
      "",
    );
    expect(withoutLegacyJobSanitizer).not.toContain("supervisorToken");

    for (const relative of [
      "server/routers/manhuaViralTemplate.ts",
      "server/routers/betaCode.ts",
      "client/src/pages/PlatformPage.tsx",
      "client/src/pages/OmniCanvas.tsx",
      "client/src/lib/jobs.ts",
      "client/src/components/PlatformProAgentDock.tsx",
    ]) {
      expect(await fs.readFile(path.join(root, relative), "utf8"), relative)
        .not.toContain("supervisorToken");
    }
  });
});
