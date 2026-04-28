/**
 * VIP 客户档案存储（用于 VIP 健康/美学动态追踪 Agent）
 *
 * 每个 VIP 客户对应一个独立的 Interactions API 会话：
 *   - 第一次「建档」：调用 Deep Research Max 生成基线分析，记录 baseInteractionId
 *   - 之后每次「月度更新」：用 lastInteractionId 作为 previous_interaction_id，
 *     Agent 会基于全部历史上下文生成新的动态调整处方
 *
 * 数据存储：JSON 文件，按 ownerId 分目录
 *   /data/agent/vip-profiles/{ownerId}/{vipId}.json
 *   /data/agent/vip-profiles/{ownerId}/_index.json   ← 列表（按更新时间排序）
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const VIP_DIR = process.env.VIP_PROFILES_DIR || "/data/agent/vip-profiles";

export interface VipUpdateEntry {
  /** 这一次更新对应的 Deep Research jobId（可点进去看完整报告） */
  jobId: string;
  /** Agent 这一次生成的 interactionId（下一次月度更新用作 previous_interaction_id） */
  interactionId?: string;
  /** 用户提交的更新内容摘要（前 200 字） */
  summary: string;
  /** 该次更新挂载的 GCS 文件名列表（仅供查阅） */
  fileNames: string[];
  createdAt: string;
}

export interface VipProfile {
  /** VIP id（系统生成） */
  vipId: string;
  /** 持有该档案的运营者（医师 / 顾问） */
  ownerId: string;
  /** VIP 客户姓名（建档时填写） */
  vipName: string;
  /** 客户基础画像（建档时一次性填写，后续更新追加而不修改） */
  baselineSummary: string;
  /** 第一次建档对应的 jobId */
  baseJobId: string;
  /** 第一次建档 Agent 返回的 interactionId（最初的「锚点」） */
  baseInteractionId?: string;
  /** 最近一次更新的 interactionId（下一次月度更新用作 previous_interaction_id） */
  lastInteractionId?: string;
  /** 历次更新记录（最新在前） */
  updates: VipUpdateEntry[];
  createdAt: string;
  updatedAt: string;
}

interface VipIndexEntry {
  vipId: string;
  vipName: string;
  updateCount: number;
  lastUpdateAt: string;
  createdAt: string;
}

interface VipIndex {
  ownerId: string;
  profiles: VipIndexEntry[];
}

function ownerDir(ownerId: string) {
  return path.join(VIP_DIR, ownerId);
}

function indexFile(ownerId: string) {
  return path.join(ownerDir(ownerId), "_index.json");
}

function profileFile(ownerId: string, vipId: string) {
  return path.join(ownerDir(ownerId), `${vipId}.json`);
}

async function readIndex(ownerId: string): Promise<VipIndex> {
  try {
    const raw = await fs.readFile(indexFile(ownerId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { ownerId, profiles: [] };
  }
}

async function writeIndex(ownerId: string, idx: VipIndex) {
  await fs.mkdir(ownerDir(ownerId), { recursive: true });
  await fs.writeFile(indexFile(ownerId), JSON.stringify(idx, null, 2));
}

export async function readProfile(ownerId: string, vipId: string): Promise<VipProfile | null> {
  try {
    const raw = await fs.readFile(profileFile(ownerId, vipId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeProfile(p: VipProfile): Promise<void> {
  await fs.mkdir(ownerDir(p.ownerId), { recursive: true });
  await fs.writeFile(profileFile(p.ownerId, p.vipId), JSON.stringify(p, null, 2));
  // 更新 index
  const idx = await readIndex(p.ownerId);
  const lastUpdate = p.updates[0]?.createdAt || p.createdAt;
  const existing = idx.profiles.find((x) => x.vipId === p.vipId);
  if (existing) {
    existing.vipName = p.vipName;
    existing.updateCount = p.updates.length;
    existing.lastUpdateAt = lastUpdate;
  } else {
    idx.profiles.push({
      vipId: p.vipId,
      vipName: p.vipName,
      updateCount: p.updates.length,
      lastUpdateAt: lastUpdate,
      createdAt: p.createdAt,
    });
  }
  idx.profiles.sort((a, b) => (b.lastUpdateAt > a.lastUpdateAt ? 1 : -1));
  await writeIndex(p.ownerId, idx);
}

/**
 * 创建一个新的 VIP 档案（建档阶段，对应一次 Deep Research Max 任务）
 */
export async function createVipProfile(args: {
  ownerId: string;
  vipName: string;
  baselineSummary: string;
  baseJobId: string;
}): Promise<VipProfile> {
  const vipId = `vip_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const now = new Date().toISOString();
  const profile: VipProfile = {
    vipId,
    ownerId: args.ownerId,
    vipName: args.vipName,
    baselineSummary: args.baselineSummary,
    baseJobId: args.baseJobId,
    updates: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeProfile(profile);
  return profile;
}

/**
 * 当 VIP 建档对应的 Deep Research 任务完成时，回填 interactionId（变为可继续接力的锚点）
 */
export async function attachBaseInteractionId(
  ownerId: string,
  vipId: string,
  baseInteractionId: string,
): Promise<void> {
  const p = await readProfile(ownerId, vipId);
  if (!p) return;
  p.baseInteractionId = baseInteractionId;
  p.lastInteractionId = baseInteractionId;
  p.updatedAt = new Date().toISOString();
  await writeProfile(p);
}

/**
 * 追加一条月度更新记录（在新 Deep Research 任务启动时调用）
 */
export async function appendVipUpdate(args: {
  ownerId: string;
  vipId: string;
  jobId: string;
  summary: string;
  fileNames: string[];
}): Promise<VipProfile | null> {
  const p = await readProfile(args.ownerId, args.vipId);
  if (!p) return null;
  const entry: VipUpdateEntry = {
    jobId: args.jobId,
    summary: args.summary.slice(0, 200),
    fileNames: args.fileNames,
    createdAt: new Date().toISOString(),
  };
  p.updates.unshift(entry);
  p.updatedAt = new Date().toISOString();
  await writeProfile(p);
  return p;
}

/**
 * 该次月度更新任务完成后，回填新的 interactionId（成为下一次月度更新的锚点）
 */
export async function attachUpdateInteractionId(
  ownerId: string,
  vipId: string,
  jobId: string,
  interactionId: string,
): Promise<void> {
  const p = await readProfile(ownerId, vipId);
  if (!p) return;
  const u = p.updates.find((x) => x.jobId === jobId);
  if (u) u.interactionId = interactionId;
  p.lastInteractionId = interactionId;
  p.updatedAt = new Date().toISOString();
  await writeProfile(p);
}

/** 列出该 owner 的全部 VIP 档案（按最近更新排序） */
export async function listVipProfiles(ownerId: string): Promise<VipIndexEntry[]> {
  const idx = await readIndex(ownerId);
  return idx.profiles;
}

/** 删除一个档案（连带 index） */
export async function deleteVipProfile(ownerId: string, vipId: string): Promise<void> {
  try { await fs.unlink(profileFile(ownerId, vipId)); } catch {}
  const idx = await readIndex(ownerId);
  idx.profiles = idx.profiles.filter((x) => x.vipId !== vipId);
  await writeIndex(ownerId, idx);
}
