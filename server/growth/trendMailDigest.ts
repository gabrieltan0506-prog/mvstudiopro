import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GrowthPlatform } from "@shared/growth";
import type { PlatformTrendCollection } from "./trendCollector";
import {
  exportSingleTrendCollectionCsv,
  readTrendMailDigestState,
  readTrendSchedulerState,
  updateTrendMailDigestState,
} from "./trendStore";
import { sendMailWithAttachments } from "../services/smtp-mailer";
import { nowShanghaiIso } from "./time";

const MAIL_DIGEST_INTERVAL_MINUTES = Math.max(
  15,
  Number(process.env.GROWTH_MAIL_DIGEST_INTERVAL_MINUTES || 60) || 60,
);
const MAIL_DIGEST_INTERVAL_MS = MAIL_DIGEST_INTERVAL_MINUTES * 60 * 1000;
const MAIL_ATTACHMENT_SPLIT_THRESHOLD_BYTES = 8 * 1024 * 1024;
const MAIL_ATTACHMENT_CHUNK_LIMIT_BYTES = 8 * 1024 * 1024;
const execFileAsync = promisify(execFile);

async function getAttachmentSize(attachment: {
  path?: string;
  content?: string | Buffer;
}) {
  if (attachment.path) {
    const stat = await fs.stat(attachment.path);
    return stat.size;
  }
  if (typeof attachment.content === "string") {
    return Buffer.byteLength(attachment.content);
  }
  if (attachment.content) {
    return attachment.content.length;
  }
  return 0;
}

async function chunkMailAttachments<T extends {
  path?: string;
  content?: string | Buffer;
}>(attachments: T[], chunkLimitBytes = MAIL_ATTACHMENT_CHUNK_LIMIT_BYTES) {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;

  for (const attachment of attachments) {
    const size = await getAttachmentSize(attachment);
    if (current.length && currentSize + size > chunkLimitBytes) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(attachment);
    currentSize += size;
  }

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
}

async function sanitizeMailAttachments<T extends {
  filename: string;
  path?: string;
  contentType?: string;
  content?: string | Buffer;
}>(attachments: T[]) {
  const valid: T[] = [];
  const dropped: T[] = [];
  const seen = new Set<string>();

  for (const attachment of attachments) {
    const dedupeKey = attachment.path || `${attachment.filename}:${attachment.contentType || "-"}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    try {
      await getAttachmentSize(attachment);
      valid.push(attachment);
    } catch {
      dropped.push(attachment);
    }
  }

  if (dropped.length) {
    console.info(
      `[growth.mail] dropped ${dropped.length} stale attachment(s): ${dropped
        .slice(0, 5)
        .map((attachment) => attachment.path || attachment.filename)
        .join(", ")}`,
    );
  }

  return { valid, dropped };
}

async function buildZipAttachment(
  attachments: Array<{
    filename: string;
    path?: string;
    content?: string | Buffer;
    contentType?: string;
  }>,
  index: number,
  total: number,
) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "growth-mail-zip-"));
  const zipPath = path.join(tempDir, total > 1 ? `creator-growth-camp-${index + 1}-of-${total}.zip` : "creator-growth-camp.zip");

  try {
    for (const attachment of attachments) {
      const content = attachment.path
        ? await fs.readFile(attachment.path)
        : (typeof attachment.content === "string" ? Buffer.from(attachment.content) : attachment.content);
      if (!content) continue;
      await fs.writeFile(path.join(tempDir, attachment.filename), content);
    }

    const fileNames = attachments.map((attachment) => attachment.filename);
    await execFileAsync("/usr/bin/zip", ["-q", "-9", zipPath, ...fileNames], {
      cwd: tempDir,
      maxBuffer: 50 * 1024 * 1024,
    });
    const buffer = await fs.readFile(zipPath);

    return {
      filename: path.basename(zipPath),
      content: buffer,
      contentType: "application/zip",
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function sendChunkedDigest(params: {
  recipient: string;
  subjectBase: string;
  textBase: string;
  htmlBase: string;
  attachments: Array<{
    filename: string;
    path?: string;
    contentType?: string;
    content?: string | Buffer;
  }>;
  sentAt: string;
}) {
  const { valid: sanitizedAttachments } = await sanitizeMailAttachments(params.attachments);
  const totalBytes = (await Promise.all(
    sanitizedAttachments.map((attachment) => getAttachmentSize(attachment)),
  )).reduce((sum, size) => sum + size, 0);

  if (!sanitizedAttachments.length) {
    await sendMailWithAttachments({
      to: params.recipient,
      subject: params.subjectBase,
      requireResend: true,
      text: params.textBase,
      html: params.htmlBase,
    });
    console.info("[growth.mail] digest sent without attachments");
    return { sentAt: params.sentAt, emailCount: 1 };
  }

  if (totalBytes <= MAIL_ATTACHMENT_SPLIT_THRESHOLD_BYTES) {
    await sendMailWithAttachments({
      to: params.recipient,
      subject: params.subjectBase,
      requireResend: true,
      text: params.textBase,
      html: params.htmlBase,
      attachments: sanitizedAttachments,
    });
    console.info(
      `[growth.mail] digest sent: emails=1 attachments=${sanitizedAttachments.length} totalBytes=${totalBytes} mode=raw`,
    );
    return { sentAt: params.sentAt, emailCount: 1 };
  }

  const rawChunks = await chunkMailAttachments(sanitizedAttachments);
  const zipChunks = await Promise.all(
    rawChunks.map((chunk, index) => buildZipAttachment(chunk, index, rawChunks.length)),
  );

  for (let index = 0; index < zipChunks.length; index += 1) {
    const attachment = zipChunks[index];
    await sendMailWithAttachments({
      to: params.recipient,
      subject: `${params.subjectBase} (${index + 1}/${zipChunks.length})`,
      requireResend: true,
      text: `${params.textBase}\n\n压缩附件分片：${index + 1}/${zipChunks.length}`,
      html: `${params.htmlBase}<p><strong>压缩附件分片：</strong>${index + 1}/${zipChunks.length}</p>`,
      attachments: [attachment],
    });
  }

  console.info(
    `[growth.mail] digest sent: emails=${zipChunks.length} attachments=${sanitizedAttachments.length} totalBytes=${totalBytes} mode=zip`,
  );

  return {
    sentAt: params.sentAt,
    emailCount: zipChunks.length,
  };
}

export async function notifyGrowthCollectionUpdate(params: {
  platform: GrowthPlatform;
  itemCount: number;
  addedCount: number;
  mergedCount: number;
  collectedAt: string;
  nextRunAt: string;
  frequencyLabel: string;
  burstMode: boolean;
  live: boolean;
  collection: PlatformTrendCollection;
}) {
  const recipient = String(process.env.GROWTH_TREND_REPORT_EMAIL || "").trim();
  if (!recipient) return;
  const digestState = await readTrendMailDigestState();
  const lastSentAtMs = digestState.lastSentAt ? new Date(digestState.lastSentAt).getTime() : 0;
  const nowIso = nowShanghaiIso();
  const withinWindow = lastSentAtMs && Date.now() - lastSentAtMs < MAIL_DIGEST_INTERVAL_MS;

  console.info(
    `[growth.mail] evaluate platform=${params.platform} recipient=${recipient} lastSentAt=${digestState.lastSentAt || "-"} intervalMinutes=${MAIL_DIGEST_INTERVAL_MINUTES}`,
  );

  if (withinWindow) {
    console.info("[growth.mail] digest skipped within hourly window");
    await updateTrendMailDigestState({
      lastWindowMinutes: MAIL_DIGEST_INTERVAL_MINUTES,
      pendingAttachmentBytes: 0,
      pendingCreatedAt: undefined,
      pendingSubjectBase: undefined,
      pendingTextBase: undefined,
      pendingHtmlBase: undefined,
      pendingAttachmentBatches: undefined,
    });
    return;
  }

  const scheduler = await readTrendSchedulerState();
  const exported = await exportSingleTrendCollectionCsv(params.collection);
  const platformFile = exported.files[0];
  const schedulerSummary = Object.values(scheduler || {})
    .map((item) =>
      `${item.platform}: ${item.lastCollectedCount || 0} 条 / 下次 ${item.nextRunAt || "-"} / ${item.lastFrequencyLabel || "-"}`,
    )
    .join("\n");

  const subjectBase = `Creator Growth Camp 数据汇总 - ${nowShanghaiIso().slice(0, 16).replace("T", " ")}`;
  const textBase =
    `[Growth Trend Scheduler ${MAIL_DIGEST_INTERVAL_MINUTES}分钟汇总]\n` +
    `最新触发平台：${params.platform}\n` +
    `最新抓取时间：${params.collectedAt}\n` +
    `最新新增数量：${params.addedCount}\n` +
    `最新合并数量：${params.mergedCount}\n` +
    `该平台当前总样本数：${params.itemCount}\n` +
    `当前 live 调度频率：${params.frequencyLabel}\n` +
    `当前 burst mode：${params.burstMode ? "ON" : "OFF"}\n` +
    `是否真实 live：${params.live ? "是" : "否"}\n` +
    `下次计划抓取：${params.nextRunAt}\n` +
    `\n[当前调度概览]\n${schedulerSummary}\n` +
    `\n[本次增量附件]\n` +
    `本次导出行数：${exported.rows}\n` +
    `清单：${exported.manifestPath}\n` +
    `说明：邮件仅附带本次触发平台的增量导出，不再附带全平台全量导出。`;
  const htmlBase =
    `<p><strong>汇总窗口：</strong>${MAIL_DIGEST_INTERVAL_MINUTES} 分钟</p>` +
    `<p><strong>最新触发平台：</strong>${params.platform}</p>` +
    `<p><strong>抓取时间：</strong>${params.collectedAt}</p>` +
    `<p><strong>本次新增：</strong>${params.addedCount}</p>` +
    `<p><strong>本次合并：</strong>${params.mergedCount}</p>` +
    `<p><strong>该平台当前总样本数：</strong>${params.itemCount}</p>` +
    `<p><strong>下次计划抓取：</strong>${params.nextRunAt}</p>` +
    `<p><strong>当前 live 调度频率：</strong>${params.frequencyLabel}</p>` +
    `<p><strong>当前 burst mode：</strong>${params.burstMode ? "ON" : "OFF"}</p>` +
    `<p><strong>是否真实 live：</strong>${params.live ? "是" : "否"}</p>` +
    `<p><strong>当前调度概览：</strong></p><p>${schedulerSummary.replace(/\n/g, "<br />")}</p>` +
    `<p><strong>本次导出行数：</strong>${exported.rows}</p>` +
    (platformFile ? `<p><strong>本次重点附件：</strong>${path.basename(platformFile.filePath)}</p>` : "") +
    `<p><strong>说明：</strong>邮件仅附带本次触发平台的增量导出，不再附带全平台全量导出。</p>`;

  const attachments = [
    ...exported.files.map((file) => ({
      filename: path.basename(file.filePath),
      path: file.filePath,
      contentType: "text/csv",
    })),
    {
      filename: path.basename(exported.manifestPath),
      path: exported.manifestPath,
      contentType: "application/json",
    },
  ];

  console.info(
    `[growth.mail] sending digest platform=${params.platform} files=${attachments.length} rows=${exported.rows} manifest=${exported.manifestPath}`,
  );

  const sendResult = await sendChunkedDigest({
    recipient,
    subjectBase,
    textBase,
    htmlBase,
    attachments,
    sentAt: nowIso,
  });

  console.info(
    `[growth.mail] digest state updated: lastSentAt=${nowIso} emailCount=${sendResult.emailCount}`,
  );
  await updateTrendMailDigestState({
    lastSentAt: nowIso,
    lastManifestPath: exported.manifestPath,
    lastWindowMinutes: MAIL_DIGEST_INTERVAL_MINUTES,
    pendingAttachmentBytes: 0,
    pendingCreatedAt: undefined,
    pendingSubjectBase: undefined,
    pendingTextBase: undefined,
    pendingHtmlBase: undefined,
    pendingAttachmentBatches: undefined,
  });
}
