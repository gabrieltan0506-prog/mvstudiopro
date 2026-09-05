/**
 * 整集成片的后期任务绑定。
 *
 * jobId + sourceUrl 把异步结果钉在“哪一集、哪一版原片”上；resultGcsUri 是长期
 * 身份，resultUrl 只作当前可播放签名链。旧任务迟到时只能进入版本历史，不能盖掉
 * 用户后来合成或选中的版本。
 */

export type ManhuaFinalPostProdBinding = {
  action: "burn_subtitle";
  jobId: string;
  sourceUrl: string;
  sourceGcsUri?: string;
  /** 提交后用户是否仍停留在这版；签名 URL 续签时用它配合 GCS 身份判同版。 */
  sourceSelected?: boolean;
  status: "queued" | "running" | "succeeded" | "failed";
  resultGcsUri?: string;
  resultUrl?: string;
  /** 成功后当前是否选中结果版；续签只更新地址，不改变用户的版本选择。 */
  resultSelected?: boolean;
  errorZh?: string;
  updatedAt: number;
};

/** 每个整集成片版本的可恢复身份；URL 可续签，job/GCS 才是长期溯源。 */
export type ManhuaFinalVersionIdentity = {
  origin: "assemble" | "burn_subtitle";
  url: string;
  jobId?: string;
  gcsUri?: string;
  errorZh?: string;
  createdAt: number;
};

export type ManhuaFinalPostProdBlock = {
  id: string;
  status?: string;
  outputUrl?: string | null;
  outputUrls?: readonly (string | null | undefined)[];
  manhuaClipQuality?: unknown;
  lastFrameUrl?: string | null;
  manhuaFinalPostProd?: ManhuaFinalPostProdBinding | null;
  manhuaFinalVersions?: readonly ManhuaFinalVersionIdentity[] | null;
};

function httpUrl(value: unknown): string {
  const url = String(value || "").trim();
  return /^https:\/\//i.test(url) ? url : "";
}

function gsUri(value: unknown): string | undefined {
  const uri = String(value || "").trim();
  return /^gs:\/\/[^/]+\/.+/i.test(uri) ? uri : undefined;
}

function versionUrls(
  newest: readonly unknown[],
  previous: readonly unknown[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...newest, ...previous]) {
    const url = httpUrl(value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function versionIdentityKey(row: ManhuaFinalVersionIdentity): string {
  return row.gcsUri || (row.jobId ? `${row.origin}:${row.jobId}` : row.url);
}

export function normalizeManhuaFinalVersionIdentities(
  raw: unknown,
): ManhuaFinalVersionIdentity[] {
  if (!Array.isArray(raw)) return [];
  const byIdentity = new Map<string, ManhuaFinalVersionIdentity>();
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const row = value as Partial<ManhuaFinalVersionIdentity>;
    const origin = row.origin === "assemble" || row.origin === "burn_subtitle"
      ? row.origin
      : null;
    const url = httpUrl(row.url);
    if (!origin || !url) continue;
    const normalized: ManhuaFinalVersionIdentity = {
      origin,
      url,
      jobId: String(row.jobId || "").trim().slice(0, 80) || undefined,
      gcsUri: gsUri(row.gcsUri),
      errorZh: String(row.errorZh || "").trim().slice(0, 160) || undefined,
      createdAt: Math.max(0, Math.floor(Number(row.createdAt) || 0)),
    };
    const key = versionIdentityKey(normalized);
    const previous = byIdentity.get(key);
    byIdentity.set(key, previous ? { ...previous, ...normalized } : normalized);
  }
  return Array.from(byIdentity.values());
}

function upsertVersionIdentity(
  previous: readonly ManhuaFinalVersionIdentity[] | null | undefined,
  next: ManhuaFinalVersionIdentity,
): ManhuaFinalVersionIdentity[] {
  const rows = normalizeManhuaFinalVersionIdentities(previous);
  const key = versionIdentityKey(next);
  const index = rows.findIndex((row) => versionIdentityKey(row) === key);
  if (index < 0) return [next, ...rows];
  return rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...next } : row);
}

export function listManhuaFinalVideoVersions(block: ManhuaFinalPostProdBlock | null | undefined) {
  return block
    ? versionUrls(
        [block.outputUrl],
        [
          ...(block.outputUrls || []),
          ...normalizeManhuaFinalVersionIdentities(block.manhuaFinalVersions).map(
            (row) => row.url,
          ),
        ],
      )
    : [];
}

export function findManhuaFinalVideoVersionIdentity(
  block: ManhuaFinalPostProdBlock | null | undefined,
  url: unknown,
): ManhuaFinalVersionIdentity | undefined {
  const target = httpUrl(url);
  if (!block || !target) return undefined;
  return normalizeManhuaFinalVersionIdentities(block.manhuaFinalVersions).find(
    (row) => row.url === target,
  );
}

export function normalizeManhuaFinalPostProdBinding(
  raw: unknown,
): ManhuaFinalPostProdBinding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Partial<ManhuaFinalPostProdBinding>;
  const jobId = String(row.jobId || "").trim().slice(0, 80);
  const sourceUrl = httpUrl(row.sourceUrl);
  if (row.action !== "burn_subtitle" || !jobId || !sourceUrl) return undefined;
  const status = ["queued", "running", "succeeded", "failed"].includes(String(row.status))
    ? (row.status as ManhuaFinalPostProdBinding["status"])
    : "queued";
  return {
    action: "burn_subtitle",
    jobId,
    sourceUrl,
    sourceGcsUri: gsUri(row.sourceGcsUri),
    sourceSelected: row.sourceSelected !== false,
    status,
    resultGcsUri: gsUri(row.resultGcsUri),
    resultUrl: httpUrl(row.resultUrl) || undefined,
    resultSelected: row.resultSelected === true,
    errorZh: String(row.errorZh || "").trim().slice(0, 160) || undefined,
    updatedAt: Math.max(0, Math.floor(Number(row.updatedAt) || 0)),
  };
}

export function beginManhuaFinalSubtitleBurn<T extends ManhuaFinalPostProdBlock>(
  block: T,
  input: { jobId: string; sourceUrl: string; sourceGcsUri?: string; updatedAt?: number },
): T & ManhuaFinalPostProdBlock {
  const sourceUrl = httpUrl(input.sourceUrl);
  const jobId = String(input.jobId || "").trim().slice(0, 80);
  if (!/^final-e\d+$/i.test(block.id) || !sourceUrl || !jobId) return block;
  const sourceIdentity = findManhuaFinalVideoVersionIdentity(block, sourceUrl);
  return {
    ...block,
    manhuaFinalPostProd: {
      action: "burn_subtitle",
      jobId,
      sourceUrl,
      sourceGcsUri: gsUri(input.sourceGcsUri) || sourceIdentity?.gcsUri,
      sourceSelected: httpUrl(block.outputUrl) === sourceUrl,
      resultSelected: false,
      status: "queued",
      updatedAt: Math.max(0, Math.floor(Number(input.updatedAt) || Date.now())),
    },
  };
}

export function updateManhuaFinalSubtitleBurnStatus<T extends ManhuaFinalPostProdBlock>(
  block: T,
  input: {
    jobId: string;
    status: "running" | "failed";
    errorZh?: string;
    updatedAt?: number;
  },
): T & ManhuaFinalPostProdBlock {
  const binding = normalizeManhuaFinalPostProdBinding(block.manhuaFinalPostProd);
  if (!binding || binding.jobId !== input.jobId || binding.status === "succeeded") return block;
  return {
    ...block,
    manhuaFinalPostProd: {
      ...binding,
      status: input.status,
      errorZh: String(input.errorZh || "").trim().slice(0, 160) || undefined,
      updatedAt: Math.max(0, Math.floor(Number(input.updatedAt) || Date.now())),
    },
  };
}

/** 查询/续签失败只记可见错误，不把已成功任务降级，也不丢长期身份。 */
export function setManhuaFinalPostProdReadError<T extends ManhuaFinalPostProdBlock>(
  block: T,
  input: { jobId: string; errorZh: string; updatedAt?: number },
): T & ManhuaFinalPostProdBlock {
  const binding = normalizeManhuaFinalPostProdBinding(block.manhuaFinalPostProd);
  if (!binding || binding.jobId !== input.jobId) return block;
  return {
    ...block,
    manhuaFinalPostProd: {
      ...binding,
      errorZh: String(input.errorZh || "").trim().slice(0, 160) || "成片链接刷新失败",
      updatedAt: Math.max(0, Math.floor(Number(input.updatedAt) || Date.now())),
    },
  };
}

export function applyManhuaFinalSubtitleBurnSuccess<T extends ManhuaFinalPostProdBlock>(
  block: T,
  input: {
    jobId: string;
    resultUrl: string;
    resultGcsUri: string;
    updatedAt?: number;
  },
): T & ManhuaFinalPostProdBlock {
  const binding = normalizeManhuaFinalPostProdBinding(block.manhuaFinalPostProd);
  const resultUrl = httpUrl(input.resultUrl);
  const resultGcsUri = gsUri(input.resultGcsUri);
  if (!binding || binding.jobId !== input.jobId || !resultUrl || !resultGcsUri) return block;

  const sameResultIdentity = binding.resultGcsUri === resultGcsUri;
  const sameSourceIdentity = Boolean(binding.sourceGcsUri);
  const currentUrl = httpUrl(block.outputUrl);
  const previousResultUrl = httpUrl(binding.resultUrl);
  const wasSucceeded = binding.status === "succeeded";
  if (wasSucceeded && binding.resultGcsUri && !sameResultIdentity) return block;
  // 首次完成时跟随提交源；后续只刷新用户仍选中的结果版，绝不把已切回的原版顶走。
  const mayPromote = wasSucceeded
    ? currentUrl === previousResultUrl || (binding.resultSelected === true && sameResultIdentity)
    : currentUrl === binding.sourceUrl ||
      (binding.sourceSelected !== false && sameSourceIdentity);
  const nextCurrentUrl = mayPromote ? resultUrl : currentUrl;
  const previousVersions = [block.outputUrl, ...(block.outputUrls || [])].filter(
    (url) =>
      !(sameResultIdentity && httpUrl(url) === previousResultUrl) &&
      !(sameSourceIdentity && httpUrl(url) === binding.sourceUrl),
  );
  const sourceHistoryUrl =
    !wasSucceeded && sameSourceIdentity && binding.sourceSelected !== false && currentUrl
      ? currentUrl
      : binding.sourceUrl;
  const existingResult = normalizeManhuaFinalVersionIdentities(block.manhuaFinalVersions).find(
    (row) => row.origin === "burn_subtitle" && row.jobId === input.jobId && row.gcsUri === resultGcsUri,
  );
  return {
    ...block,
    status: nextCurrentUrl ? "done" : block.status,
    outputUrl: nextCurrentUrl || block.outputUrl,
    outputUrls: versionUrls(
      [nextCurrentUrl, resultUrl, sourceHistoryUrl],
      previousVersions,
    ),
    manhuaFinalVersions: upsertVersionIdentity(block.manhuaFinalVersions, {
      origin: "burn_subtitle",
      url: resultUrl,
      jobId: input.jobId,
      gcsUri: resultGcsUri,
      createdAt: existingResult?.createdAt ?? Math.max(0, Math.floor(Number(input.updatedAt) || Date.now())),
    }),
    // 同一 GCS 媒体续签不是重新编码；仅真正切换当前成片时清掉原版质检。
    manhuaClipQuality: wasSucceeded && sameResultIdentity ? block.manhuaClipQuality : undefined,
    lastFrameUrl: wasSucceeded && sameResultIdentity ? block.lastFrameUrl : undefined,
    manhuaFinalPostProd: {
      ...binding,
      status: "succeeded",
      sourceUrl: sourceHistoryUrl,
      resultGcsUri,
      resultUrl,
      resultSelected: mayPromote,
      errorZh: undefined,
      updatedAt: Math.max(0, Math.floor(Number(input.updatedAt) || Date.now())),
    },
  };
}

/** 旧烧字版本续签：按 job/GCS 身份替换临时 URL，不改变用户当前选择。 */
export function refreshManhuaFinalVersionIdentity<T extends ManhuaFinalPostProdBlock>(
  block: T,
  input: { jobId: string; resultUrl: string; resultGcsUri: string },
): T & ManhuaFinalPostProdBlock {
  const resultUrl = httpUrl(input.resultUrl);
  const resultGcsUri = gsUri(input.resultGcsUri);
  if (!resultUrl || !resultGcsUri) return block;
  const rows = normalizeManhuaFinalVersionIdentities(block.manhuaFinalVersions);
  const matched = rows.find(
    (row) =>
      row.origin === "burn_subtitle" &&
      (row.gcsUri === resultGcsUri || (row.jobId && row.jobId === input.jobId)),
  );
  if (!matched || (matched.gcsUri && matched.gcsUri !== resultGcsUri)) return block;
  const selected = httpUrl(block.outputUrl) === matched.url;
  const nextRows = upsertVersionIdentity(rows, {
    ...matched,
    url: resultUrl,
    jobId: input.jobId,
    gcsUri: resultGcsUri,
    errorZh: undefined,
  });
  const oldUrl = matched.url;
  const nextVersions = versionUrls(
    [selected ? resultUrl : block.outputUrl, resultUrl],
    (block.outputUrls || []).filter((url) => httpUrl(url) !== oldUrl),
  );
  const binding = normalizeManhuaFinalPostProdBinding(block.manhuaFinalPostProd);
  return {
    ...block,
    outputUrl: selected ? resultUrl : block.outputUrl,
    outputUrls: nextVersions,
    manhuaFinalVersions: nextRows,
    manhuaFinalPostProd:
      binding?.jobId === input.jobId
        ? { ...binding, resultUrl, resultGcsUri, errorZh: undefined }
        : block.manhuaFinalPostProd,
  };
}

export function setManhuaFinalVersionReadError<T extends ManhuaFinalPostProdBlock>(
  block: T,
  input: { jobId: string; errorZh: string },
): T & ManhuaFinalPostProdBlock {
  const rows = normalizeManhuaFinalVersionIdentities(block.manhuaFinalVersions);
  let changed = false;
  const nextRows = rows.map((row) => {
    if (row.jobId !== input.jobId) return row;
    changed = true;
    return { ...row, errorZh: String(input.errorZh || "").trim().slice(0, 160) };
  });
  return changed ? { ...block, manhuaFinalVersions: nextRows } : block;
}

export function selectManhuaFinalVideoVersion<T extends ManhuaFinalPostProdBlock>(
  block: T,
  selected: unknown,
): T & ManhuaFinalPostProdBlock {
  const selectedUrl = httpUrl(selected);
  const versions = listManhuaFinalVideoVersions(block);
  if (!selectedUrl || !versions.includes(selectedUrl)) return block;
  return {
    ...block,
    status: "done",
    outputUrl: selectedUrl,
    outputUrls: versionUrls([selectedUrl], versions),
    manhuaClipQuality: undefined,
    lastFrameUrl: undefined,
    manhuaFinalPostProd: block.manhuaFinalPostProd
      ? {
          ...block.manhuaFinalPostProd,
          sourceSelected:
            block.manhuaFinalPostProd.status === "succeeded"
              ? block.manhuaFinalPostProd.sourceSelected
              : selectedUrl === block.manhuaFinalPostProd.sourceUrl,
          resultSelected:
            block.manhuaFinalPostProd.status === "succeeded"
              ? selectedUrl === block.manhuaFinalPostProd.resultUrl
              : false,
        }
      : block.manhuaFinalPostProd,
  };
}

/** 新的整集合成成为当前版；在途烧字保留为晚到归档任务，其余旧绑定清掉。 */
export function replaceManhuaFinalAssembleVersion<T extends ManhuaFinalPostProdBlock>(
  block: T,
  next: unknown | { url: unknown; jobId?: string; createdAt?: number },
): T & ManhuaFinalPostProdBlock {
  const nextInput = next && typeof next === "object" && "url" in next
    ? (next as { url: unknown; jobId?: string; createdAt?: number })
    : { url: next };
  const outputUrl = httpUrl(nextInput.url);
  if (!outputUrl) return block;
  const pendingBinding = normalizeManhuaFinalPostProdBinding(block.manhuaFinalPostProd);
  return {
    ...block,
    status: "done",
    outputUrl,
    outputUrls: versionUrls([outputUrl], [block.outputUrl, ...(block.outputUrls || [])]),
    manhuaClipQuality: undefined,
    lastFrameUrl: undefined,
    manhuaFinalPostProd:
      pendingBinding?.status === "queued" || pendingBinding?.status === "running"
        ? { ...pendingBinding, sourceSelected: false, resultSelected: false }
        : undefined,
    manhuaFinalVersions: upsertVersionIdentity(block.manhuaFinalVersions, {
      origin: "assemble",
      url: outputUrl,
      jobId: String(nextInput.jobId || "").trim().slice(0, 80) || undefined,
      createdAt: Math.max(0, Math.floor(Number(nextInput.createdAt) || Date.now())),
    }),
  };
}
