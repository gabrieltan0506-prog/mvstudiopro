import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Offline only: emit a reviewable config; never invokes Fly or overwrites fly.toml. */
export function dualMachineConfig(source, stage, machineId) {
  if (!["worker", "shared"].includes(stage))
    throw new Error("stage must be worker or shared");
  if (machineId !== "7812595b294778")
    throw new Error(
      "Only the verified existing sin rig is permitted; re-inventory before changing this guard"
    );
  if (source.includes("MANHUA_HEAVY_WORKER_SPLIT"))
    throw new Error("Source already contains heavy-worker configuration");
  let processes = 0;
  let result = source.replace(/^(  (?:app|rig) = "env )/gm, prefix => {
    processes++;
    return `${prefix}MANHUA_HEAVY_WORKER_SPLIT=1 MANHUA_HEAVY_MACHINE_ID=${machineId} `;
  });
  let vms = 0;
  result = result.replace(/\[\[vm\]\]([\s\S]*?)(?=\n\[|$)/g, block => {
    if (!/memory = '8gb'/.test(block) || !/memory_mb = 8192/.test(block))
      throw new Error("Expected 8GB retained");
    vms++;
    if (/processes = \['rig'\]/.test(block))
      return block.replace(/cpus = \d+/, "cpus = 2");
    if (/processes = \['app'\]/.test(block))
      return stage === "shared"
        ? block
            .replace(/cpu_kind = 'performance'/, "cpu_kind = 'shared'")
            .replace(/cpus = \d+/, "cpus = 4")
        : block;
    throw new Error("Unexpected process VM");
  });
  if (processes !== 2 || vms !== 2)
    throw new Error("Source topology changed; review manually");
  return `# PROPOSAL ONLY. Stage=${stage}. Deployment requires separate user approval.\n# Existing comments describe the original baseline; VM declarations below are proposed values.\n${result}`;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.stdout.write(
    dualMachineConfig(
      readFileSync(new URL("../fly.toml", import.meta.url), "utf8"),
      process.argv[2],
      process.argv[3]
    )
  );
}
