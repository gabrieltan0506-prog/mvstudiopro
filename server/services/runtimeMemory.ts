import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getHeapStatistics } from "node:v8";

/** 仅记录数值、静态阶段标签与 PID；不记录堆内容、请求、环境或凭证。 */
const active = new Map<number, { label: string; startedAt: string }>();
const samples: Array<ReturnType<typeof runtimeMemorySnapshot>> = [];
let token = 0;
let dirty = false;
let writing = false;
let timer: ReturnType<typeof setInterval> | undefined;

export function runtimeMemorySnapshot(label: string) {
  const m = process.memoryUsage();
  return { at: new Date().toISOString(), pid: process.pid, label,
    rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal,
    external: m.external, arrayBuffers: m.arrayBuffers,
    heapLimit: getHeapStatistics().heap_size_limit,
    active: Array.from(active.values()).slice(-24) };
}

function record(label: string) {
  samples.push(runtimeMemorySnapshot(label));
  if (samples.length > 96) samples.splice(0, samples.length - 96);
  if (!process.env.FLY_MACHINE_ID || process.env.NODE_ENV === "test") return;
  dirty = true;
  if (!writing) void flush();
}

async function flush() {
  writing = true;
  const root = path.resolve(process.env.GROWTH_STORE_DIR || "/data/growth", "..", "runtime-diagnostics");
  const file = path.join(root, "memory.json");
  const tmp = `${file}.${process.pid}.next`;
  try {
    await mkdir(root, { recursive: true });
    while (dirty) {
      dirty = false;
      await writeFile(tmp, JSON.stringify({ version: 1, samples }), { mode: 0o600 });
      await rename(tmp, file);
    }
  } catch {
    console.warn("[runtime-memory] 数值诊断落盘失败");
  } finally { writing = false; }
}

export async function observeRuntimeMemory<T>(label: string, work: () => Promise<T>): Promise<T> {
  const id = ++token;
  active.set(id, { label, startedAt: new Date().toISOString() });
  record(`${label}:start`);
  try { return await work(); }
  finally { active.delete(id); record(`${label}:end`); }
}

export function startRuntimeMemorySampling() {
  if (timer) return;
  record("boot");
  timer = setInterval(() => record("sample"), 15_000);
  timer.unref?.();
}
