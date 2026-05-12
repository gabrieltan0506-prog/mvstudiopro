/**
 * 将平台页传入的 strategicMapContext（自由 JSON）压成可进 LLM 提示词的简体中文摘要，
 * 避免仅依赖整张 blueprint 的 JSON 切片导致模型忽略「定位 / 赛道 / 客群」灵魂字段。
 */

const MAX_DEFAULT = 3500;

function appendLines(parts: string[], label: string, value: unknown) {
  if (typeof value === "string" && value.trim()) {
    parts.push(`${label}：${value.trim()}`);
    return;
  }
  if (Array.isArray(value) && value.length) {
    const flat = value
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (typeof x === "object" && x && !Array.isArray(x)) {
          const o = x as { name?: unknown; title?: unknown; label?: unknown };
          const s = String(o.name ?? o.title ?? o.label ?? "").trim();
          return s;
        }
        return "";
      })
      .filter(Boolean);
    if (flat.length) parts.push(`${label}：${flat.join("；")}`);
  }
}

/**
 * 从 contentBlueprint 取出 strategicMapContext 并格式化为提示词片段。
 * 识别常见键名（中英混用 tolerant）；未知结构则退化为 JSON 截断。
 */
export function summarizeStrategicMapContextFromBlueprint(contentBlueprint: unknown, maxChars = MAX_DEFAULT): string {
  if (!contentBlueprint || typeof contentBlueprint !== "object" || Array.isArray(contentBlueprint)) {
    return "";
  }
  const raw = (contentBlueprint as Record<string, unknown>).strategicMapContext;
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") {
    const t = raw.trim();
    return t ? t.slice(0, maxChars) : "";
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    const s = String(raw).trim();
    return s ? s.slice(0, maxChars) : "";
  }

  const o = raw as Record<string, unknown>;
  const parts: string[] = [];

  const stringKeys: Array<[string, string]> = [
    ["summary", "摘要"],
    ["positioning", "战略定位"],
    ["tagline", "主张 / tagline"],
    ["valueProposition", "核心价值"],
    ["narrative", "叙事主线"],
    ["heroTitle", "主标题"],
    ["subtitle", "副标题"],
    ["notes", "备注"],
  ];
  for (const [en, zh] of stringKeys) {
    appendLines(parts, zh, o[en]);
  }

  appendLines(parts, "内容赛道 / 支柱", o.contentTracks ?? o.tracks ?? o.pillars ?? o.内容赛道);
  appendLines(parts, "目标客户", o.audiences ?? o.targetAudiences ?? o.clients ?? o.客群);
  appendLines(parts, "品牌基因", o.brandGenes ?? o.brandDNA ?? o.brandDna ?? o.dna);

  if (parts.length) {
    return parts.join("\n").slice(0, maxChars);
  }

  try {
    return JSON.stringify(raw).slice(0, maxChars);
  } catch {
    return "";
  }
}
