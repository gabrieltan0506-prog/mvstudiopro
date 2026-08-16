import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateLegacyUpscaleAccess } from "../../api/google";

describe("旧 Google 高清放大入口门禁", () => {
  it("只接受 POST 且只允许管理员或监管角色", () => {
    expect(
      validateLegacyUpscaleAccess({ method: "GET", role: "admin", upscaleFactor: "x2" }),
    ).toMatchObject({ ok: false, status: 405 });
    expect(
      validateLegacyUpscaleAccess({ method: "POST", role: "user", upscaleFactor: "x2" }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      validateLegacyUpscaleAccess({ method: "POST", role: "supervisor", upscaleFactor: "x4" }),
    ).toEqual({ ok: true, upscaleFactor: "x4" });
  });

  it("严格拒绝缺失、x3 与任意未知倍率", () => {
    for (const factor of [undefined, "", "x3", "x8", "2x"]) {
      expect(
        validateLegacyUpscaleAccess({ method: "POST", role: "admin", upscaleFactor: factor }),
      ).toMatchObject({ ok: false, status: 400, error: "unsupported_upscale_factor" });
    }
    expect(
      validateLegacyUpscaleAccess({ method: "POST", role: "admin", upscaleFactor: "X2" }),
    ).toEqual({ ok: true, upscaleFactor: "x2" });
  });

  it("在读取 Vertex 专用配置前先完成高清放大的独立鉴权与分派", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../api/google.ts", import.meta.url)),
      "utf8",
    );
    const upscaleBranch = source.indexOf('if (op === "upscaleImage")');
    const vertexProjectRead = source.indexOf("const projectId = s(process.env.VERTEX_PROJECT_ID)");

    expect(upscaleBranch).toBeGreaterThan(0);
    expect(vertexProjectRead).toBeGreaterThan(upscaleBranch);
    expect(source.slice(upscaleBranch, vertexProjectRead)).toContain("resolveGoogleGatewayUser(req)");
    expect(source.slice(upscaleBranch, vertexProjectRead)).toContain("validateLegacyUpscaleAccess");
  });
});
