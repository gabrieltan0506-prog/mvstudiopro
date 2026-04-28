/**
 * 「指挥官档案」持久化（Agent 场景的 a 战略边界 + d 核心资产）
 *
 * 一次性设定，所有 Agent 任务自动注入。避免每次都重复填。
 * 存储：JSON 文件，按 userId
 *   /data/agent/commander-profiles/{userId}.json
 */

import fs from "node:fs/promises";
import path from "node:path";

const PROFILE_DIR = process.env.COMMANDER_PROFILE_DIR || "/data/agent/commander-profiles";

export interface CommanderProfile {
  /** a · 战略边界：专业领域 + 排除领域 */
  strategicBoundary?: string;
  /** d · 核心资产：硬护城河（学历、专业、独门经验、跨界能力） */
  coreAssets?: string;
  /** c · 默认输出格式偏好（可选，覆盖系统默认） */
  outputFormatPreferences?: string;
  /** 备注 / 长期目标 */
  notes?: string;
  /** 最后更新时间 */
  updatedAt: string;
}

function profileFile(userId: string) {
  return path.join(PROFILE_DIR, `${userId}.json`);
}

export async function readCommanderProfile(userId: string): Promise<CommanderProfile | null> {
  try {
    const raw = await fs.readFile(profileFile(userId), "utf-8");
    return JSON.parse(raw) as CommanderProfile;
  } catch {
    return null;
  }
}

export async function writeCommanderProfile(userId: string, patch: Partial<CommanderProfile>): Promise<CommanderProfile> {
  const existing = (await readCommanderProfile(userId)) || { updatedAt: new Date().toISOString() };
  const next: CommanderProfile = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  await fs.writeFile(profileFile(userId), JSON.stringify(next, null, 2));
  return next;
}
