import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildKbObjectName,
  getEnterpriseKbBucket,
} from "./enterpriseAgentUpload";

// ─── buildKbObjectName ──────────────────────────────────────────────────────

describe("buildKbObjectName", () => {
  it("基础格式：enterprise-agent/userId/agents/agentId/<nanoid>-<filename>", () => {
    const out = buildKbObjectName({
      userId: 123,
      agentId: 45,
      fileName: "guide.pdf",
    });
    // 把可变 nanoid 段替换成占位符再断言
    expect(out).toMatch(
      /^enterprise-agent\/123\/agents\/45\/[a-z0-9]{8}-guide\.pdf$/,
    );
  });

  it("空格 → 横线 + 折叠", () => {
    const out = buildKbObjectName({
      userId: 1,
      agentId: 2,
      fileName: "客户   战败 名单.pdf",
    });
    expect(out).not.toContain("   ");
    expect(out).toMatch(/客户-战败-名单\.pdf$/);
  });

  it("路径分隔符 / \\ 被切掉（防越权写）", () => {
    const out = buildKbObjectName({
      userId: 1,
      agentId: 2,
      fileName: "../../../etc/passwd.txt",
    });
    expect(out).not.toContain("..");
    expect(out).toMatch(/passwd\.txt$/);
  });

  it("Windows path 也被切掉", () => {
    const out = buildKbObjectName({
      userId: 1,
      agentId: 2,
      fileName: "C:\\Users\\evil\\hack.docx",
    });
    expect(out).not.toContain(":");
    expect(out).not.toContain("\\");
    expect(out).toMatch(/hack\.docx$/);
  });

  it("控制字符 / 非法字符 → 横线", () => {
    const out = buildKbObjectName({
      userId: 1,
      agentId: 2,
      fileName: 'evil<>:"|?*.pdf',
    });
    expect(out).toMatch(/^enterprise-agent\/1\/agents\/2\/[a-z0-9]{8}-pdf$|^enterprise-agent\/1\/agents\/2\/[a-z0-9]{8}-[-]+pdf$|.+\.pdf$/);
    // 关键断言：非法字符全部消失
    for (const ch of "<>:|?*") {
      expect(out.includes(ch)).toBe(false);
    }
  });

  it("过长文件名截到 200 字以内", () => {
    const veryLong = "a".repeat(500) + ".pdf";
    const out = buildKbObjectName({
      userId: 1,
      agentId: 2,
      fileName: veryLong,
    });
    // nanoid(8) + "-" + safeFilename，safeFilename ≤ 200
    const tail = out.split("/").pop()!;
    const filenamePart = tail.replace(/^[a-z0-9]{8}-/, "");
    expect(filenamePart.length).toBeLessThanOrEqual(200);
  });

  it("空文件名 fallback 到 'kb'", () => {
    const out = buildKbObjectName({
      userId: 1,
      agentId: 2,
      fileName: "",
    });
    expect(out).toMatch(/^enterprise-agent\/1\/agents\/2\/[a-z0-9]{8}-kb$/);
  });

  it("不同 userId / agentId 隔离前缀", () => {
    const a = buildKbObjectName({ userId: 100, agentId: 1, fileName: "x.txt" });
    const b = buildKbObjectName({ userId: 200, agentId: 1, fileName: "x.txt" });
    expect(a.startsWith("enterprise-agent/100/")).toBe(true);
    expect(b.startsWith("enterprise-agent/200/")).toBe(true);
    expect(a).not.toBe(b);
  });
});

// ─── getEnterpriseKbBucket ──────────────────────────────────────────────────

describe("getEnterpriseKbBucket", () => {
  // 备份 / 还原 env，避免污染其他测试
  const ORIGINAL = {
    ENTERPRISE_KB_BUCKET: process.env.ENTERPRISE_KB_BUCKET,
    GCS_USER_UPLOAD_BUCKET: process.env.GCS_USER_UPLOAD_BUCKET,
    GCS_PDF_EXPORT_BUCKET: process.env.GCS_PDF_EXPORT_BUCKET,
    VERTEX_GCS_BUCKET: process.env.VERTEX_GCS_BUCKET,
  };

  beforeEach(() => {
    delete process.env.ENTERPRISE_KB_BUCKET;
    delete process.env.GCS_USER_UPLOAD_BUCKET;
    delete process.env.GCS_PDF_EXPORT_BUCKET;
    delete process.env.VERTEX_GCS_BUCKET;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(ORIGINAL)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("ENTERPRISE_KB_BUCKET 显式覆盖优先级最高", () => {
    process.env.ENTERPRISE_KB_BUCKET = "mvstudio-enterprise";
    process.env.GCS_USER_UPLOAD_BUCKET = "user-uploads";
    process.env.VERTEX_GCS_BUCKET = "vertex";
    expect(getEnterpriseKbBucket()).toBe("mvstudio-enterprise");
  });

  it("无 ENTERPRISE_KB_BUCKET 时 fallback 到 GCS_USER_UPLOAD_BUCKET", () => {
    process.env.GCS_USER_UPLOAD_BUCKET = "user-uploads";
    expect(getEnterpriseKbBucket()).toBe("user-uploads");
  });

  it("再 fallback 到 GCS_PDF_EXPORT_BUCKET", () => {
    process.env.GCS_PDF_EXPORT_BUCKET = "pdf-exports";
    expect(getEnterpriseKbBucket()).toBe("pdf-exports");
  });

  it("再 fallback 到 VERTEX_GCS_BUCKET", () => {
    process.env.VERTEX_GCS_BUCKET = "vertex-temp";
    expect(getEnterpriseKbBucket()).toBe("vertex-temp");
  });

  it("全无配置 fallback 到默认 mv-studio-pro-vertex-video-temp", () => {
    expect(getEnterpriseKbBucket()).toBe("mv-studio-pro-vertex-video-temp");
  });

  it("env 含前后空白字符自动 trim", () => {
    process.env.ENTERPRISE_KB_BUCKET = "  trimmed-bucket  ";
    expect(getEnterpriseKbBucket()).toBe("trimmed-bucket");
  });
});
