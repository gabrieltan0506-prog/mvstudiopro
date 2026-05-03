/**
 * 小紅書雙筆記 · 價值卡子彈（X11）
 * 前後端共用：從 actionableSteps / copywriting / scriptContext 動態提取，避免行業硬編碼。
 */

export type XhsDualNoteBullet = { title: string; desc: string };

export const XHS_DUAL_NOTE_DEFAULT_BULLETS: [XhsDualNoteBullet, XhsDualNoteBullet] = [
  { title: "高端 IP 战略", desc: "定制化顶层商业逻辑输出。" },
  { title: "精准受众转化", desc: "击穿行业信息差与信任壁垒。" },
];

function stripEnumeration(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*[\u2022\u00B7•·\-\*]\s+/, "")
    .replace(/^\s*\d{1,2}[.、．]\s*/, "")
    .trim();
}

function lineToBullet(line: string): XhsDualNoteBullet {
  const raw = stripEnumeration(line);
  if (!raw) return XHS_DUAL_NOTE_DEFAULT_BULLETS[0];
  const parts = raw.split(/[:：]/);
  if (parts.length >= 2) {
    const title = parts[0].trim().slice(0, 28);
    const desc = parts.slice(1).join("：").trim().slice(0, 220);
    return {
      title: title || XHS_DUAL_NOTE_DEFAULT_BULLETS[0].title,
      desc: desc || raw.slice(0, 220),
    };
  }
  if (raw.length <= 18) {
    return { title: raw, desc: raw };
  }
  return {
    title: raw.slice(0, 16).trim() || XHS_DUAL_NOTE_DEFAULT_BULLETS[0].title,
    desc: raw.slice(16).trim().slice(0, 220) || raw,
  };
}

export function extractXhsDualBulletsFromLines(lines: string[]): [XhsDualNoteBullet, XhsDualNoteBullet] {
  const filtered = lines
    .map((l) => stripEnumeration(String(l ?? "")))
    .filter((l) => l.length > 5);
  if (filtered.length === 0) {
    return [XHS_DUAL_NOTE_DEFAULT_BULLETS[0], XHS_DUAL_NOTE_DEFAULT_BULLETS[1]];
  }
  const first = lineToBullet(filtered[0]);
  if (filtered.length === 1) {
    return [first, XHS_DUAL_NOTE_DEFAULT_BULLETS[1]];
  }
  return [first, lineToBullet(filtered[1])];
}

/** 平台卡：優先 actionableSteps 陣列，不足時併入 copywriting 分行。 */
export function extractXhsDualBulletsFromActionableStepsOrCopy(
  actionableSteps: unknown,
  copywriting: string,
): [XhsDualNoteBullet, XhsDualNoteBullet] {
  const lines: string[] = [];
  if (Array.isArray(actionableSteps)) {
    for (const s of actionableSteps) {
      const t = String(s ?? "").trim();
      if (t) lines.push(t);
    }
  }
  const extra = String(copywriting || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 5);
  return extractXhsDualBulletsFromLines([...lines, ...extra]);
}

/** HTML 匯出：自持久化的 scriptContextForPanels 提取。 */
export function extractXhsDualBulletsFromScriptContext(script: string): [XhsDualNoteBullet, XhsDualNoteBullet] {
  const raw = String(script ?? "").trim();
  if (!raw) {
    return [XHS_DUAL_NOTE_DEFAULT_BULLETS[0], XHS_DUAL_NOTE_DEFAULT_BULLETS[1]];
  }
  const lines = raw
    .split(/\n+/)
    .map((l) => stripEnumeration(l))
    .filter((l) => l.length > 5);
  return extractXhsDualBulletsFromLines(lines);
}
