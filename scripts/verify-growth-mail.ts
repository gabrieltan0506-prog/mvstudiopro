import path from "node:path";
import { collectTrendPlatforms } from "../server/growth/trendCollector";
import { exportTrendCollectionsCsv, mergeTrendCollections } from "../server/growth/trendStore";
import { sendMailWithAttachments } from "../server/services/smtp-mailer";
import type { GrowthPlatform } from "../shared/growth";

async function main() {
  const platforms = (process.argv.slice(2).filter(Boolean) as GrowthPlatform[]);
  const selectedPlatforms = platforms.length ? platforms : (["xiaohongshu"] as GrowthPlatform[]);
  const recipient = String(process.env.GROWTH_TREND_REPORT_EMAIL || "").trim();

  if (!recipient) {
    throw new Error("Missing GROWTH_TREND_REPORT_EMAIL");
  }

  const collected = await collectTrendPlatforms(selectedPlatforms);
  const store = await mergeTrendCollections(collected.collections);
  const exported = await exportTrendCollectionsCsv();

  await sendMailWithAttachments({
    to: recipient,
    subject: `Creator Growth Camp CSV 验收测试（${selectedPlatforms.join("、")}）`,
    text: `已完成一次真实抓取更新，并附上 CSV 与 manifest。\n平台：${selectedPlatforms.join("、")}`,
    html: `<p>已完成一次真实抓取更新，并附上 CSV 与 manifest。</p><p>平台：${selectedPlatforms.join("、")}</p>`,
    requireResend: true,
    attachments: [
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
    ],
  });

  console.log(JSON.stringify({
    updatedAt: store.updatedAt,
    platforms: selectedPlatforms,
    files: exported.files,
    manifest: exported.manifestPath,
    errors: collected.errors,
    counts: Object.fromEntries(
      Object.entries(collected.collections).map(([platform, collection]) => [platform, collection?.items.length || 0]),
    ),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
