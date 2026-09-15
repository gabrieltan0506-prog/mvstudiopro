/**
 * 3D 资产记录任务（PR-3 · Lux3D 资产链）：导入 → 校验 → 采用。
 *
 * 与 manhua3dTask.ts 同风格：文件 JSON 持久化、原子写、幂等 id、可注入依赖。
 * 资产挂在既有 m3d_* 任务上（getCompletedManhua3dSource 负责本人/已完成/来源回执核对），
 * 所以这里不接收下载地址或本地路径，也不会为了下载失败而重新生成。
 *
 * Lux3D 服务端能力在本 PR 只回答“可不可用、为什么”，不发任何 HTTP 请求。
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { downloadGcsObject } from "./gcs.js";
import { getCompletedManhua3dSource } from "./manhua3dTask.js";
import {
  deriveManhua3dAssetVerification,
  inspectGlbFromReader,
  MANHUA_3D_ASSET_MAX_GLB_BYTES,
} from "./manhua3dAssetImport.js";
import {
  manhua3dAssetRecordSchema,
  type Manhua3dAssetAxis,
  type Manhua3dAssetRecord,
  type Manhua3dAssetSource,
  type Manhua3dAssetUnits,
  type Manhua3dLux3dCapability,
} from "../../shared/manhua3dAsset.js";

const PRIMARY_ASSET_DIR = "/data/growth/manhua-3d-assets";
const SOURCE_JOB_ID_PATTERN = /^m3d_[a-zA-Z0-9_.-]{1,150}$/;
const ASSET_ID_PATTERN = /^m3da_[a-zA-Z0-9_.-]{1,150}$/;

/** 插件合同（aholo-lux3d 0.1.1 SKILL.md）：凭证只认这两个环境变量名，且只在服务端。 */
export const LUX3D_CREDENTIAL_ENV = {
  cn: "LUX3D_CN_API_KEY",
  international: "LUX3D_GLOBAL_API_KEY",
} as const;

type StoredManhua3dAsset = Manhua3dAssetRecord & { userId: number };

type Manhua3dAssetDependencies = {
  resolveSourceGlb: typeof getCompletedManhua3dSource;
  downloadGlb: (gcsUri: string) => Promise<Uint8Array>;
  /** 只回答“有没有”，永远不读值。 */
  hasLux3dCredential: (region: keyof typeof LUX3D_CREDENTIAL_ENV) => boolean;
  now: () => Date;
};

const productionDependencies: Manhua3dAssetDependencies = {
  resolveSourceGlb: getCompletedManhua3dSource,
  downloadGlb: async gcsUri => (await downloadGcsObject({ gcsUri })).buffer,
  hasLux3dCredential: region => Boolean(String(process.env[LUX3D_CREDENTIAL_ENV[region]] || "").trim()),
  now: () => new Date(),
};

let dependencies = productionDependencies;
const inflight = new Map<string, Promise<Manhua3dAssetRecord>>();

function assetDir(): string {
  return String(process.env.MANHUA_3D_ASSET_DIR || PRIMARY_ASSET_DIR).trim() || PRIMARY_ASSET_DIR;
}

function isoNow(): string {
  return dependencies.now().toISOString();
}

function recordPath(assetId: string): string {
  return path.join(assetDir(), `${String(assetId || "").replace(/[^a-zA-Z0-9_.-]+/g, "_")}.json`);
}

async function ensureStore(): Promise<void> {
  try {
    await fs.mkdir(assetDir(), { recursive: true });
  } catch (error) {
    console.error("[manhua3dAssetTask] persistent asset store unavailable", error);
    throw new Error("manhua3d_asset_store_unavailable");
  }
}

async function writeRecord(record: StoredManhua3dAsset): Promise<void> {
  await ensureStore();
  const target = recordPath(record.assetId);
  const temporary = `${target}.tmp.${process.pid}.${randomUUID()}`;
  await fs.writeFile(temporary, JSON.stringify(record, null, 2));
  await fs.rename(temporary, target);
}

/**
 * 首次落盘走排他创建（与 manhua3dTask.createRecordExclusive 同口径）：
 * 跨实例/跨进程同 assetId 并发导入时只有一个写入者，输家读回赢家的记录，不用 rename 覆盖。
 * 1467 R1：原先 rename 覆盖，两个实例各写各的 createdAt/checkedAt，后写者盖掉先写者。
 */
async function createRecordExclusive(record: StoredManhua3dAsset): Promise<boolean> {
  await ensureStore();
  try {
    await fs.writeFile(recordPath(record.assetId), JSON.stringify(record, null, 2), { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
    throw error;
  }
}

/** 读到的记录必须过 schema；坏文件当不存在，绝不返回半个资产。 */
async function readRecord(assetId: string): Promise<StoredManhua3dAsset | null> {
  await ensureStore();
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(recordPath(assetId), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
  const userId = Number((raw as { userId?: unknown })?.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const { userId: _omit, ...rest } = raw as Record<string, unknown>;
  const parsed = manhua3dAssetRecordSchema.safeParse(rest);
  return parsed.success ? { ...parsed.data, userId } : null;
}

function toView(record: StoredManhua3dAsset): Manhua3dAssetRecord {
  const { userId: _omit, ...view } = record;
  return view;
}

function assetIdFor(input: {
  userId: number;
  sourceJobId: string;
  units?: Manhua3dAssetUnits;
  axis?: Manhua3dAssetAxis;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["m3da", input.userId, input.sourceJobId, input.units ?? "", input.axis ?? ""]))
    .digest("hex");
  return `m3da_${digest.slice(0, 20)}`;
}

/**
 * Lux3D 服务端能力：本 PR 未接 HTTP 适配器，因此无论有无凭证都是“不可用”，只是原因不同。
 * 这是真实状态，前端据此显示原因并引导走导入链，不是空按钮。
 */
export function getManhua3dLux3dCapability(): Manhua3dLux3dCapability {
  const regions = (Object.keys(LUX3D_CREDENTIAL_ENV) as Array<keyof typeof LUX3D_CREDENTIAL_ENV>).filter(
    region => dependencies.hasLux3dCredential(region)
  );
  if (regions.length === 0) {
    return {
      available: false,
      reasonCode: "no_server_credentials",
      reasonZh: "服务端未配置 Lux3D 凭证（LUX3D_CN_API_KEY / LUX3D_GLOBAL_API_KEY 仅限 Fly env）；可先导入已有 GLB",
      importFallback: true,
    };
  }
  // TODO(PR-3 后续)：接 server/services/lux3dAdapter.ts（GET /lux3d/v1/generate/task/get 续查）后才可能返回 available:true；
  // 新生成仍需单独授权，canSubmitGeneration 保持 false。
  return {
    available: false,
    reasonCode: "adapter_not_wired",
    reasonZh: "服务端已有 Lux3D 凭证，但任务适配器尚未接通；可先导入已有 GLB",
    importFallback: true,
  };
}

export async function importManhua3dAsset(input: {
  userId: number;
  sourceJobId: string;
  assetRef: string;
  units?: Manhua3dAssetUnits;
  axis?: Manhua3dAssetAxis;
  source?: Manhua3dAssetSource;
}): Promise<Manhua3dAssetRecord> {
  const sourceJobId = String(input.sourceJobId || "").trim();
  const assetRef = String(input.assetRef || "").trim();
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) throw new Error("invalid_user_id");
  if (!SOURCE_JOB_ID_PATTERN.test(sourceJobId) || !assetRef) throw new Error("invalid_manhua_3d_asset_input");

  const assetId = assetIdFor({ userId: input.userId, sourceJobId, units: input.units, axis: input.axis });
  const persisted = await readRecord(assetId);
  if (persisted) {
    if (persisted.userId !== input.userId) throw new Error("manhua3d_asset_forbidden");
    return toView(persisted);
  }
  const running = inflight.get(assetId);
  if (running) return running;

  const operation = (async () => {
    let source: Awaited<ReturnType<typeof getCompletedManhua3dSource>>;
    try {
      source = await dependencies.resolveSourceGlb(sourceJobId, input.userId, assetRef);
    } catch {
      throw new Error("manhua3d_asset_source_missing");
    }
    const inspection = await inspectGlbFromReader(
      () => dependencies.downloadGlb(source.gcsUri),
      MANHUA_3D_ASSET_MAX_GLB_BYTES
    );
    const now = isoNow();
    const verification = deriveManhua3dAssetVerification({
      inspection,
      units: input.units,
      axis: input.axis,
      checkedAt: now,
    });
    const record: StoredManhua3dAsset = {
      userId: input.userId,
      assetId,
      revision: 1,
      source: input.source ?? "upload",
      sourceJobId,
      assetRef,
      glb: {
        kind: "gcs",
        gcsUri: source.gcsUri,
        sha256: inspection.ok ? inspection.sha256 : source.sha256,
        bytes: inspection.ok ? inspection.bytes : source.bytes,
      },
      units: input.units,
      axis: input.axis,
      geometry: inspection.ok ? inspection.geometry : undefined,
      skeleton: inspection.ok ? inspection.skeleton : undefined,
      materials: inspection.ok ? inspection.materials : undefined,
      verification,
      createdAt: now,
      updatedAt: now,
    };
    // 写盘前再过一遍 schema：verified 却缺几何这类矛盾在这里就拦下，不落坏记录。
    manhua3dAssetRecordSchema.parse(toView(record));
    if (!(await createRecordExclusive(record))) {
      // 另一实例先落盘：以它的为准（同 assetId = 同人同任务同单位轴向，内容等价）
      const winner = await readRecord(assetId);
      if (winner && winner.userId === input.userId) return toView(winner);
      if (winner) throw new Error("manhua3d_asset_forbidden");
      // 文件存在却读不回（坏文件）：用本次结果覆盖修复
      await writeRecord(record);
    }
    return toView(record);
  })();
  inflight.set(assetId, operation);
  try {
    return await operation;
  } finally {
    if (inflight.get(assetId) === operation) inflight.delete(assetId);
  }
}

export async function getManhua3dAsset(assetId: string, userId: number): Promise<Manhua3dAssetRecord | null> {
  const id = String(assetId || "").trim();
  if (!ASSET_ID_PATTERN.test(id)) return null;
  const record = await readRecord(id);
  return record && record.userId === userId ? toView(record) : null;
}

/** 按来源任务恢复查询：同一 m3d_* 可能有多次不同单位/轴向的导入尝试，全部列出由用户选。 */
export async function listManhua3dAssetsForJob(sourceJobId: string, userId: number): Promise<Manhua3dAssetRecord[]> {
  const jobId = String(sourceJobId || "").trim();
  if (!SOURCE_JOB_ID_PATTERN.test(jobId)) return [];
  await ensureStore();
  const names = await fs.readdir(assetDir()).catch(() => [] as string[]);
  const found: Manhua3dAssetRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || !name.startsWith("m3da_")) continue;
    const record = await readRecord(name.slice(0, -".json".length)).catch(() => null);
    if (record && record.userId === userId && record.sourceJobId === jobId) found.push(toView(record));
  }
  return found.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 采用：只有 verified 才能采用；重复采用幂等；采用会推进 revision。 */
export async function adoptManhua3dAsset(assetId: string, userId: number): Promise<Manhua3dAssetRecord> {
  const id = String(assetId || "").trim();
  const record = ASSET_ID_PATTERN.test(id) ? await readRecord(id) : null;
  if (!record || record.userId !== userId) throw new Error("manhua3d_asset_not_found");
  if (record.verification.status !== "verified") throw new Error("manhua3d_asset_not_verified");
  if (record.adoptedAt) return toView(record);
  const next: StoredManhua3dAsset = {
    ...record,
    adoptedAt: isoNow(),
    updatedAt: isoNow(),
    revision: record.revision + 1,
  };
  await writeRecord(next);
  return toView(next);
}

export function setManhua3dAssetDependenciesForTests(overrides: Partial<Manhua3dAssetDependencies>): void {
  if (process.env.NODE_ENV !== "test") throw new Error("test_dependencies_only");
  dependencies = { ...productionDependencies, ...overrides };
}

export function resetManhua3dAssetDependenciesForTests(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("test_dependencies_only");
  dependencies = productionDependencies;
  inflight.clear();
}
