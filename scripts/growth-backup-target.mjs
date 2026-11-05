import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_GROWTH_BACKUP_REPOSITORY =
  "gabrieltan0506-prog/mvstudiopro-growth-data";
export function runBackupGh(args) {
  // A scheduled backup must use its explicit dedicated token, never ambient gh login.
  if (!String(process.env.GH_TOKEN || "").trim())
    throw Error("growth_backup_private_token_required");
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GH_HOST: "github.com" },
  });
}

export function privateGrowthBackupTarget(
  rawGh = runBackupGh,
  {
    repository = process.env.GROWTH_BACKUP_REPOSITORY ||
      DEFAULT_GROWTH_BACKUP_REPOSITORY,
  } = {}
) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw Error("growth_backup_repository_invalid");
  // Injected test transport still passes exactly the same privacy and identity gate.
  const info = JSON.parse(
    rawGh(["repo", "view", repository, "--json", "nameWithOwner,isPrivate"])
  );
  if (
    info?.isPrivate !== true ||
    String(info.nameWithOwner || "").toLowerCase() !== repository.toLowerCase()
  )
    throw Error("growth_backup_target_must_be_confirmed_private");
  const gh = args => {
    if (args[0] === "repo" && args[1] === "view") return JSON.stringify(info);
    if (args[0] === "api") {
      const endpoint = args.at(-1);
      if (
        typeof endpoint !== "string" ||
        !endpoint.startsWith(`repos/${info.nameWithOwner}/`) ||
        args.includes("--method") ||
        args.includes("-X")
      )
        throw Error("growth_backup_repository_scope_violation");
      return rawGh(args);
    }
    if (args[0] !== "release" || args.includes("--repo") || args.includes("-R"))
      throw Error("growth_backup_repository_scope_violation");
    // Code repository commits do not exist in the data repository. Release creation
    // uses the private repository's own default branch, never GITHUB_SHA from code.
    const scoped = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--target") {
        i++;
        continue;
      }
      scoped.push(args[i]);
    }
    return rawGh([...scoped, "--repo", info.nameWithOwner]);
  };
  return { repository: info.nameWithOwner, gh };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const { repository } = privateGrowthBackupTarget();
    console.log(JSON.stringify({ repository, private: true }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
