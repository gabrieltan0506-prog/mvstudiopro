import { execFile } from "node:child_process";

/** Do not release media locks or remove files until the process and its pipes close. */
export function runChildUntilClosed(
  command: string, args: string[], signal: AbortSignal,
  onPid: (pid: number | undefined) => void = () => {},
  killGraceMs = 5_000,
  options: { maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let failure: Error | null = null;
    let output = { stdout: "", stderr: "" };
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    // Node's signal option rejects on abort, before close. Manage the signal ourselves.
    const child = execFile(command, args, { maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => { failure = error; output = { stdout, stderr }; });
    onPid(child.pid);
    const abort = () => {
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), killGraceMs);
      killTimer.unref?.();
    };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", error => { failure = error; });
    child.once("close", () => {
      signal.removeEventListener("abort", abort);
      if (killTimer) clearTimeout(killTimer);
      onPid(undefined);
      if (signal.aborted) reject(signal.reason ?? new Error("media task cancelled"));
      else if (failure) reject(Object.assign(failure, output));
      else resolve(output);
    });
    if (signal.aborted) abort();
  });
}
