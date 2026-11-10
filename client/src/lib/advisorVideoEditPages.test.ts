import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("接线：数字人传作品类型、面板额度查询带类型", () => {
  const src = (f: string) => readFileSync(f, "utf8");
  it("数字人后期上下文带 digital_human；面板额度查询随上下文带类型，漫剧缺省仍只传 projectId", () => {
    expect(src("client/src/components/DigitalHumanPostProdWorkbench.tsx")).toMatch(/projectId: props\.draft\.project\?\.id \|\| props\.draft\.id,[\s\S]{0,120}projectKind: "digital_human" as const/);
    expect(src("client/src/components/canvas/ManhuaCreativeAdvisorPanel.tsx")).toMatch(/getManhuaAdvisorQuota\.useQuery\(props\.projectId \? \{ projectId: props\.projectId, \.\.\.\(projectKind && projectKind !== "manhua" \? \{ projectKind \} : \{\}\) \} : undefined/);
  });
});
