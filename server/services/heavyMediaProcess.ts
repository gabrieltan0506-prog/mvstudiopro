import type { ExecFileOptions } from "node:child_process";
import { runChildUntilClosed } from "./runChildUntilClosed";
import { mediaRuntime } from "./postProdResources";

let children = 0;
export function heavyMediaChildrenBusy() {
  return children > 0;
}
/** Reuse the existing close-before-release primitive, preserving each native caller's timeout/buffer. */
export async function execHeavyMedia(
  command: string,
  args: readonly string[],
  options: ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const signals = [
    options.signal,
    options.timeout ? AbortSignal.timeout(options.timeout) : undefined,
  ].filter(Boolean) as AbortSignal[];
  const signal = signals.length
    ? AbortSignal.any(signals)
    : new AbortController().signal;
  const state = mediaRuntime.getStore();
  children++;
  try {
    return await runChildUntilClosed(
      command,
      [...args],
      signal,
      pid => {
        if (state) state.childPid = pid;
      },
      5_000,
      { maxBuffer: options.maxBuffer ?? 1024 * 1024 }
    );
  } finally {
    children--;
  }
}
