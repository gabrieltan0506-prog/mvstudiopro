// Deployed-code/configuration gate. Metadata access is NOT a restore test.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { growthColdStoreReleaseTag } from "../shared/growthColdStoreRelease.mjs";

export async function checkDeployedGrowthRouting({
  expectedRepository,
  env = process.env,
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  fetchImpl = fetch,
} = {}) {
  const repository = env.GROWTH_BACKUP_REPOSITORY || "gabrieltan0506-prog/mvstudiopro-growth-data";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expectedRepository || "")
      || repository !== expectedRepository)
    throw Error("growth_deployed_backup_repository_mismatch");
  const base = String(env.GROWTH_GITHUB_PRIVATE_COLD_STORE_BASE_URL || "").replace(/\/$/, "");
  if (base !== `https://github.com/${repository}/releases/download/growth-cold-store-latest`)
    throw Error("growth_deployed_private_reader_url_missing_or_mismatch");
  const token = env.GROWTH_BACKUP_GITHUB_TOKEN;
  if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token))
    throw Error("growth_deployed_private_reader_token_missing_or_invalid");
  if (growthColdStoreReleaseTag("platform-current-douyin.batch-123-1.part-0000") !== "growth-current-batch-123-1"
      || growthColdStoreReleaseTag("archive-2026-09-11-00.tar.gz") !== "growth-archive-2026-09-11")
    throw Error("growth_deployed_routing_version_mismatch");
  for (const relative of ["scripts/snapshot-growth-platform-current-batch.mts", "scripts/cleanup-growth-current-snapshot.mts", "scripts/validate-growth-archive.py", "scripts/validate-growth-backup-directories.py"]) {
    if (!(await fs.lstat(path.join(root, relative))).isFile())
      throw Error("growth_deployed_required_file_missing");
  }
  for (const relative of ["shared/growthBackupGeneration.mjs", "shared/growthArchiveRestore.mjs", "shared/growthPrivateAssetFetch.mjs", "scripts/growth-archive-retire.mjs"])
    await import(pathToFileURL(path.join(root, relative)).href);
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const metadata = async suffix => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${suffix}`, {
      headers, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw Error(`growth_deployed_private_metadata_unavailable:${response.status}`);
    return response.json();
  };
  const info = await metadata("");
  if (info.private !== true || String(info.full_name).toLowerCase() !== repository.toLowerCase())
    throw Error("growth_deployed_private_repository_unconfirmed");
  if (!Array.isArray(await metadata("/releases?per_page=1")))
    throw Error("growth_deployed_release_metadata_invalid");
  return { repository, codeAndConfigurationReady: true, metadataReadable: true, backupContentDownloaded: false, restoreVerified: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkDeployedGrowthRouting({ expectedRepository: process.argv[2] }).then(result => {
    console.log(JSON.stringify(result));
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
