import { gsUriFromSignedGcsUrl } from "../../shared/manhuaMultiview";
import { createHash } from "node:crypto";
import {
  DIGITAL_HUMAN_BACKUP_INTERVAL_MS,
  collectDigitalHumanBackupSources,
  digitalHumanBackupIdSchema,
  digitalHumanBackupSchema,
  type DigitalHumanBackup,
  type DigitalHumanBackupSummary,
} from "../../shared/digitalHumanBackup";
import {
  digitalHumanDraftSchema,
  type DigitalHumanDraft,
} from "../../shared/digitalHumanStudio";
import {
  copyGcsObjectVersion,
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  statGcsObjectVersion,
  uploadBufferToGcs,
} from "./gcs";
import {
  DigitalHumanDraftConflict,
  readDigitalHumanCloudDraft,
  writeDigitalHumanCloudDraft,
} from "./digitalHumanDraftStore";
import {
  loadSucceededJobOutputSources,
  resolveRegisteredPostProdMediaSource,
} from "./postProdMediaSource";
import { getManhuaWorldTask } from "./manhuaWorldTask";
import { readExistingManhua3dTask } from "./manhua3dTask";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const prefix = (owner: number) => {
  if (!Number.isSafeInteger(owner) || owner <= 0)
    throw new Error("需要有效登录账号");
  return `digital-human-backups/user-${owner}/`;
};
const missing = (e: unknown) =>
  e instanceof Error && e.message === "gcs_stat_failed:404";
const conflict = (e: unknown) =>
  e instanceof Error && e.message.startsWith("gcs_upload_failed:412:");
const message = (e: unknown) =>
  e instanceof Error ? e.message : "云备份暂未完成";

/** 服务端以本人任务回执补足草稿只保留 taskId 的三维资产。 */
async function discoverResources(
  owner: number,
  draft: DigitalHumanDraft
): Promise<DigitalHumanBackup["resources"]> {
  const ids = new Set<string>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== "object") return;
    for (const [key, value] of Object.entries(v)) {
      if (
        ["worldTaskId", "modelTaskId", "taskId", "environmentTaskId"].includes(
          key
        ) &&
        typeof value === "string" &&
        /^(mw|m3d)_/.test(value)
      )
        ids.add(value);
      else if (value && typeof value === "object") visit(value);
      else if (
        (key.includes(":") || key.includes(".")) &&
        typeof value === "string" &&
        /^[\[{]/.test(value)
      ) {
        try {
          visit(JSON.parse(value));
        } catch {
          /* 旧非JSON问答不是任务登记。 */
        }
      }
    }
  };
  visit(draft);
  const resources: DigitalHumanBackup["resources"] = [];
  for (const taskId of Array.from(ids)) {
    const kind = taskId.startsWith("mw_") ? "world" : "model";
    const view =
      kind === "world"
        ? await getManhuaWorldTask(taskId, owner)
        : await readExistingManhua3dTask(taskId, owner);
    if (!view)
      throw new Error("部分三维任务回执无法核实，原备份保留，未标记完整");
    // 不备份短效签名或供应商页面；媒体归档以稳定 gs:// 为准。
    const safe = JSON.parse(
      JSON.stringify(view, (key, value) =>
        /ExpiresAt$/.test(key) ||
        (typeof value === "string" && /[?&]X-Goog-/i.test(value))
          ? undefined
          : value
      )
    );
    resources.push({ kind, taskId, view: safe });
  }
  return resources;
}

const real = {
  read: downloadGcsObjectVersioned,
  write: uploadBufferToGcs,
  list: listGcsObjectNamesByPrefix,
  stat: statGcsObjectVersion,
  copy: copyGcsObjectVersion,
  bucket: getGcsBucketName,
  getDraft: readDigitalHumanCloudDraft,
  saveDraft: writeDigitalHumanCloudDraft,
  resources: discoverResources,
  owned: async (owner: number) => {
    const sources = await loadSucceededJobOutputSources(
      String(owner),
      getGcsBucketName()
    );
    return (source: string) =>
      resolveRegisteredPostProdMediaSource(
        { userId: String(owner), source },
        undefined,
        { jobObjects: sources.objects, jobUrls: sources.urls }
      );
  },
  now: () => Date.now(),
};
export type DigitalHumanBackupDeps = typeof real;

/** 可注入云存储边界验证并发、断线、归属及恢复；生产只在服务端使用真实依赖。 */
export function createDigitalHumanBackupService(
  deps: DigitalHumanBackupDeps = real
) {
  const uri = (name: string) => `gs://${deps.bucket()}/${name}`;
  const manifestName = (owner: number, id: string) =>
    `${prefix(owner)}manifests/${digitalHumanBackupIdSchema.parse(id)}.json`;
  const summary = (b: DigitalHumanBackup): DigitalHumanBackupSummary => ({
    id: b.id,
    createdAt: b.createdAt,
    status: b.status,
    reason: b.reason,
    title: b.draft.project?.title || b.draft.source?.title || "数字人制作稿",
    assetCount: b.assets.length,
    savedAssets: b.assets.filter(a => a.backupGeneration).length,
    error: b.error || b.assets.find(a => a.error)?.error,
  });
  async function read(owner: number, id: string) {
    const response = await deps.read({ gcsUri: uri(manifestName(owner, id)) });
    const backup = digitalHumanBackupSchema.parse(
      JSON.parse(response.buffer.toString("utf8"))
    );
    if (
      backup.owner !== owner ||
      backup.draft.owner !== String(owner) ||
      backup.id !== id
    )
      throw new Error("云备份身份不匹配");
    return { backup, generation: response.generation };
  }
  async function persist(
    backup: DigitalHumanBackup,
    expectedGeneration: string
  ) {
    const body = digitalHumanBackupSchema.parse(backup);
    const result = await deps.write({
      objectName: manifestName(body.owner, body.id),
      buffer: Buffer.from(JSON.stringify(body)),
      contentType: "application/json",
      ifGenerationMatch: expectedGeneration,
    });
    if (!result.generation) throw new Error("云备份缺少版本回执");
    // 清单为真源；索引失败不抹掉已经成功的CAS，列表会从缺失/待完成清单补回。
    try {
      await deps.write({
        objectName: `${prefix(body.owner)}index/${body.id}.json`,
        buffer: Buffer.from(JSON.stringify(summary(body))),
        contentType: "application/json",
      });
    } catch {
      console.warn("[digitalHumanBackup] 索引待补", body.id);
    }
    return result.generation;
  }
  async function create(
    owner: number,
    options: {
      expectedGeneration?: string;
      requestId?: string;
      reason?: DigitalHumanBackup["reason"];
      localDraft?: DigitalHumanDraft;
    } = {}
  ) {
    const current = await deps.getDraft(owner);
    if (
      options.expectedGeneration !== undefined &&
      options.expectedGeneration !== current.generation
    )
      throw new DigitalHumanDraftConflict();
    const draft = digitalHumanDraftSchema.parse(
      options.localDraft || current.draft
    );
    if (draft.owner !== String(owner)) throw new Error("云备份账号不匹配");
    if (Buffer.byteLength(JSON.stringify(draft)) > 8 * 1024 * 1024)
      throw new Error("制作稿超过8MB，未截断备份");
    const reason = options.reason || "manual";
    const time =
      reason === "automatic"
        ? Math.floor(deps.now() / DIGITAL_HUMAN_BACKUP_INTERVAL_MS) *
          DIGITAL_HUMAN_BACKUP_INTERVAL_MS
        : deps.now();
    // 用户点击产生的编号绑定快照；自动备份每十分钟一个槽，反复保存不会每分钟新建。
    const suffix = hash(
      reason === "automatic"
        ? `${owner}:automatic`
        : options.requestId ||
            `${owner}:${current.generation}:${hash(JSON.stringify(draft))}`
    ).slice(0, 32);
    const id = `${time}-${suffix}`;
    if (options.requestId || reason === "before-restore") {
      // 原请求断线后按同一编号查回，不再次复制或生成新的快照。
      const entries = await deps.list({
        prefix: `${prefix(owner)}manifests/`,
        allPages: true,
      });
      const match = entries.find(name => name.endsWith(`-${suffix}.json`));
      if (match)
        return summary(
          (await read(owner, match.split("/").pop()!.slice(0, -5))).backup
        );
    }
    try {
      return summary((await read(owner, id)).backup);
    } catch (e) {
      if (!missing(e)) throw e;
    }
    let sources: string[] = [], discoveryError: string | undefined;
    try { sources = collectDigitalHumanBackupSources(draft); }
    catch (e) { discoveryError = message(e); }
    const backup: DigitalHumanBackup = {
      format: "digital-human-backup-v1",
      id,
      owner,
      createdAt: new Date(time).toISOString(),
      draft,
      sourceGeneration: current.generation,
      error: discoveryError,
      reason,
      assets: sources.map(source => ({
        source,
      })),
      resources: [],
      discoveryComplete: false,
      nextAsset: 0,
      status: "pending",
    };
    try {
      await persist(backup, "0");
    } catch (e) {
      if (!conflict(e)) throw e;
      return summary((await read(owner, id)).backup);
    }
    return summary(backup);
  }
  async function list(owner: number) {
    const names = await deps.list({
      prefix: `${prefix(owner)}manifests/`,
      allPages: true,
    });
    const result: DigitalHumanBackupSummary[] = [];
    for (const name of names) {
      if (
        !name.startsWith(`${prefix(owner)}manifests/`) ||
        !name.endsWith(".json")
      )
        continue;
      const id = name.split("/").pop()!.slice(0, -5);
      digitalHumanBackupIdSchema.parse(id);
      let item: DigitalHumanBackupSummary | undefined;
      try {
        item = JSON.parse(
          (
            await deps.read({ gcsUri: uri(`${prefix(owner)}index/${id}.json`) })
          ).buffer.toString("utf8")
        );
        if (item?.id !== id) throw new Error("云备份索引身份不匹配");
      } catch (e) {
        if (!missing(e)) throw e;
      }
      // 迟到索引不得把已完成清单永远显示为pending；缺索引也不能丢掉快照。
      if (!item || item.status !== "complete")
        item = summary((await read(owner, id)).backup);
      result.push(item);
    }
    return result.sort((a, b) => b.id.localeCompare(a.id));
  }
  async function advance(owner: number, id: string) {
    let { backup, generation } = await read(owner, id);
    if (backup.status === "complete") return summary(backup);
    const save = async () => {
      generation = await persist(backup, generation);
    };
    try {
      if (!backup.discoveryComplete) {
        collectDigitalHumanBackupSources(backup.draft);
        backup.resources = await deps.resources(owner, backup.draft);
        const extra = backup.resources.flatMap(r =>
          collectDigitalHumanBackupSources(r.view).filter(s =>
            s.startsWith("gs://")
          )
        );
        backup.assets = Array.from(
          new Set([...backup.assets.map(a => a.source), ...extra])
        ).map(
          source => backup.assets.find(a => a.source === source) || { source }
        );
        backup.discoveryComplete = true;
        backup.error = undefined;
        await save();
      }
      // 旧pending清单可能含其他项目的任务媒体；重算所需集合，保留有效复制回执及原稿历史。
      const required = new Set([
        ...collectDigitalHumanBackupSources(backup.draft),
        ...backup.resources.flatMap(r => collectDigitalHumanBackupSources(r.view).filter(s => s.startsWith("gs://"))),
      ]);
      const retained = backup.assets.filter(a => required.has(a.source));
      if (retained.length !== backup.assets.length) {
        backup.assets = retained;
        backup.nextAsset = 0;
        backup.error = undefined;
        await save();
      }
      const trusted = new Set(
        backup.resources.flatMap(r =>
          collectDigitalHumanBackupSources(r.view).filter(s =>
            s.startsWith("gs://")
          )
        )
      );
      const aliases = new Map<string, string>();
      for (const { view } of backup.resources) {
        const add = (obj: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(obj))
            if (key.endsWith("GcsUri") && typeof value === "string") {
              const link = obj[key.replace(/GcsUri$/, "Url")];
              if (typeof link === "string") aliases.set(link, value);
            }
        };
        add(view);
        if (view.assets && typeof view.assets === "object")
          add(view.assets as Record<string, unknown>);
      }
      const owned = await deps.owned(owner);
      // 每次最多四项；rewrite token及每项结果立即落盘，大项目可续同一备份号。
      let count = 0;
      const length = backup.assets.length,
        start = backup.nextAsset % (length || 1);
      for (let offset = 0; offset < length && count < 4; offset++) {
        const index = (start + offset) % length,
          asset = backup.assets[index];
        backup.nextAsset = (index + 1) % length;
        if (asset.backupGeneration) continue;
        count++;
        try {
          if (!asset.resolvedSource) {
            // 短效HTTPS读链可能已从权威回执移除；只接受与本人任务资产精确对应的GCS对象。
            const canonical = gsUriFromSignedGcsUrl(asset.source) || asset.source;
            const resolved =
              aliases.get(asset.source) ||
              (trusted.has(canonical)
                ? canonical
                : await owned(asset.source));
            if (!resolved.startsWith(`gs://${deps.bucket()}/`))
              throw new Error(
                "此素材尚无站内云归档，备份未完整；请先将原素材保存到站内"
              );
            const stat = await deps.stat({
              gcsUri: resolved,
              signal: AbortSignal.timeout(20_000),
            });
            if (!stat.crc32c || stat.byteLength === undefined)
              throw new Error("素材缺少云端完整性信息，未标记已备份");
            Object.assign(asset, {
              resolvedSource: resolved,
              generation: stat.generation,
              bytes: stat.byteLength,
              crc32c: stat.crc32c,
            });
            await save();
          }
          const destinationObject = `${prefix(owner)}assets/${hash(`${asset.resolvedSource}:${asset.generation}`)}`;
          const result = await deps.copy({
            sourceUri: asset.resolvedSource!,
            sourceGeneration: asset.generation!,
            destinationObject,
            rewriteToken: asset.rewriteToken,
            signal: AbortSignal.timeout(20_000),
          });
          if (result.generation) {
            const copied = await deps.stat({
              gcsUri: result.gcsUri,
              signal: AbortSignal.timeout(20_000),
            });
            if (
              copied.crc32c !== asset.crc32c ||
              copied.byteLength !== asset.bytes ||
              copied.generation !== result.generation
            )
              throw new Error("云端副本校验失败，原稿未变");
            Object.assign(asset, {
              backup: result.gcsUri,
              backupGeneration: copied.generation,
              rewriteToken: undefined,
              error: undefined,
            });
          } else {
            asset.rewriteToken = result.rewriteToken;
            asset.error = undefined;
          }
        } catch (e) {
          if (conflict(e)) throw e;
          asset.error = message(e);
        }
        await save();
      }
      if (
        backup.discoveryComplete &&
        backup.assets.every(a => Boolean(a.backupGeneration))
      ) {
        backup.status = "complete";
        backup.error = undefined;
        await save();
      }
    } catch (e) {
      if (conflict(e)) return summary((await read(owner, id)).backup);
      backup.error = message(e);
      await save();
    }
    return summary(backup);
  }
  async function restore(
    owner: number,
    id: string,
    expectedGeneration: string
  ) {
    if (!/^\d+$/.test(expectedGeneration))
      throw new DigitalHumanDraftConflict();
    const { backup } = await read(owner, id);
    if (
      backup.status !== "complete" ||
      !backup.discoveryComplete ||
      backup.assets.some(a => !a.backupGeneration)
    )
      throw new Error("云备份尚未完整，不能回填；请先继续备份");
    const journalName = `${prefix(owner)}restores/${id}-${expectedGeneration}.json`;
    let journal: {
      tokens: Record<string, string>;
      checked: string[];
      safetyBackupId?: string;
      saving?: boolean;
    } = { tokens: {}, checked: [] };
    let journalGeneration = "0";
    try {
      const record = await deps.read({ gcsUri: uri(journalName) });
      journal = JSON.parse(record.buffer.toString("utf8"));
      journalGeneration = record.generation;
    } catch (e) {
      if (!missing(e)) throw e;
    }
    const saveJournal = async () => {
      const result = await deps.write({
        objectName: journalName,
        buffer: Buffer.from(JSON.stringify(journal)),
        contentType: "application/json",
        ifGenerationMatch: journalGeneration,
      });
      if (!result.generation) throw new Error("回填进度保存失败，未切换制作稿");
      journalGeneration = result.generation;
    };
    const current = await deps.getDraft(owner);
    if (current.generation !== expectedGeneration) {
      if (
        journal.saving &&
        JSON.stringify(current.draft) === JSON.stringify(backup.draft)
      )
        return {
          status: "restored" as const,
          ...current,
          draft: backup.draft,
          safetyBackupId: journal.safetyBackupId,
        };
      throw new DigitalHumanDraftConflict();
    }
    // 先保全当前完整稿件；即使媒体读取或CAS失败，原版本也有独立快照。
    if (current.draft && !journal.safetyBackupId) {
      journal.safetyBackupId = (
        await create(owner, { expectedGeneration, reason: "before-restore" })
      ).id;
      await saveJournal();
    }
    let processed = 0;
    for (const asset of backup.assets) {
      if (journal.checked.includes(asset.source)) continue;
      if (processed++ >= 4) break;
      if (
        !asset.backup?.startsWith(uri(`${prefix(owner)}assets/`)) ||
        !asset.resolvedSource?.startsWith(`gs://${deps.bucket()}/`)
      )
        throw new Error("备份媒体范围无效，未回填");
      const saved = await deps.stat({
        gcsUri: asset.backup,
        signal: AbortSignal.timeout(20_000),
      });
      if (
        saved.generation !== asset.backupGeneration ||
        saved.crc32c !== asset.crc32c ||
        saved.byteLength !== asset.bytes
      )
        throw new Error("备份媒体校验失败，未回填");
      try {
        const original = await deps.stat({
          gcsUri: asset.resolvedSource,
          signal: AbortSignal.timeout(20_000),
        });
        if (
          original.crc32c !== asset.crc32c ||
          original.byteLength !== asset.bytes
        )
          throw new Error("原素材内容已变化，未覆盖新素材或回填旧稿");
      } catch (e) {
        if (!missing(e)) throw e;
        const restored = await deps.copy({
          sourceUri: asset.backup,
          sourceGeneration: asset.backupGeneration!,
          destinationObject: asset.resolvedSource.slice(
            `gs://${deps.bucket()}/`.length
          ),
          rewriteToken: journal.tokens[asset.source],
          signal: AbortSignal.timeout(20_000),
        });
        if (!restored.generation) {
          if (!restored.rewriteToken) throw new Error("恢复复制没有返回进度");
          journal.tokens[asset.source] = restored.rewriteToken;
          await saveJournal();
          continue;
        }
        const original = await deps.stat({
          gcsUri: asset.resolvedSource,
          signal: AbortSignal.timeout(20_000),
        });
        if (
          original.crc32c !== asset.crc32c ||
          original.byteLength !== asset.bytes
        )
          throw new Error("恢复素材校验失败，未回填");
      }
      journal.checked.push(asset.source);
      delete journal.tokens[asset.source];
      await saveJournal();
    }
    if (journal.checked.length < backup.assets.length)
      return {
        status: "restoring" as const,
        remaining: backup.assets.length - journal.checked.length,
        safetyBackupId: journal.safetyBackupId,
      };
    if (journal.safetyBackupId) {
      const safety = await advance(owner, journal.safetyBackupId);
      if (safety.status !== "complete") {
        if (safety.error)
          throw new Error(`回填前备份当前稿件尚未完成：${safety.error}`);
        return {
          status: "restoring" as const,
          remaining: safety.assetCount - safety.savedAssets,
          safetyBackupId: journal.safetyBackupId,
        };
      }
    }
    // 原URI和指纹原样保留。CAS阻止覆盖其他设备的新稿；恢复绝不生成新任务。
    // 原任务仍须属于本账号且可读取；回填不复活已删除/失权的三维任务。
    await deps.resources(owner, backup.draft);
    journal.saving = true;
    await saveJournal();
    const result = await deps.saveDraft(
      owner,
      backup.draft,
      expectedGeneration
    );
    return {
      status: "restored" as const,
      ...result,
      draft: backup.draft,
      safetyBackupId: journal.safetyBackupId,
    };
  }
  return { create, list, advance, restore, read };
}
export const digitalHumanBackups = createDigitalHumanBackupService();

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
const nextPending = new Map<number, number>();
/** app常驻进程运行，浏览器关闭后仍按十分钟快照；只复制已有媒体，绝不生成。 */
export function startDigitalHumanBackupWorker() {
  if (timer || !process.env.FLY_APP_NAME) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const names = await real.list({
        prefix: "digital-human-drafts/",
        allPages: true,
      });
      for (const name of names) {
        const match = /^digital-human-drafts\/user-(\d+)\/current\.json$/.exec(
          name
        );
        if (!match) continue;
        const owner = Number(match[1]);
        try {
          await digitalHumanBackups.create(owner, { reason: "automatic" });
          const pending = (await digitalHumanBackups.list(owner))
            .filter(b => b.status === "pending")
            .sort((a, b) => a.id.localeCompare(b.id));
          if (pending.length) {
            const cursor = (nextPending.get(owner) || 0) % pending.length;
            nextPending.set(owner, cursor + 1);
            await digitalHumanBackups.advance(owner, pending[cursor].id);
          }
        } catch {
          console.warn("[digitalHumanBackup] 账号云备份待续", owner);
        }
      }
    } catch {
      console.warn("[digitalHumanBackup] 自动备份扫描暂不可用，下轮继续");
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  void tick();
}
