/**
 * 0920 实链第四轮跑挂的回归：先传先读时，**后面几组还没上传的分片也必须有就绪闸**。
 *
 * 当时的错是就绪闸只在「已登记」时才建 → 第 5 段（第二组）还没上传就被读片取用 →
 * 「第2集第5段缺少对应备料，已停止」，整集 0 入库。
 * 这里用一个极小的闸门模型复现：先建闸再读＝会等；只在登记时建闸＝读到空。
 */
import { describe, expect, it } from "vitest";

type Gate = { promise: Promise<void>; resolve: () => void };

function makeGateTable(preCreateIndexes: readonly number[]) {
  const table = new Map<number, Gate>();
  const readyOf = (index: number): Gate => {
    let row = table.get(index);
    if (!row) {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => { resolve = res; });
      row = { promise, resolve };
      table.set(index, row);
    }
    return row;
  };
  for (const index of preCreateIndexes) readyOf(index);
  return { table, readyOf };
}

/** 模拟读片：闸在就等，闸不在就直接去取备料（当年的 bug 形态）。 */
async function readSegment(
  table: Map<number, Gate>,
  videos: Map<number, string>,
  index: number,
): Promise<string> {
  const gate = table.get(index);
  if (gate) await gate.promise;
  const video = videos.get(index);
  if (!video) throw new Error(`第${index + 1}段缺少对应备料，已停止`);
  return video;
}

describe("先传先读：就绪闸必须开跑前全量预建", () => {
  it("全量预建：第二组晚 20ms 到，读片会等，拿到备料", async () => {
    const { table, readyOf } = makeGateTable([0, 1, 2, 3, 4]);
    const videos = new Map<number, string>();
    // 第一组（0–3）立刻就绪
    for (const i of [0, 1, 2, 3]) { videos.set(i, `seg-${i}.mp4`); readyOf(i).resolve(); }
    // 第二组（4）晚到
    setTimeout(() => { videos.set(4, "seg-4.mp4"); readyOf(4).resolve(); }, 20);
    await expect(readSegment(table, videos, 4)).resolves.toBe("seg-4.mp4");
  });

  it("只在登记时建闸（当年的写法）：第 5 段没闸可等，立刻报缺备料", async () => {
    const { table, readyOf } = makeGateTable([]);
    const videos = new Map<number, string>();
    for (const i of [0, 1, 2, 3]) { videos.set(i, `seg-${i}.mp4`); readyOf(i).resolve(); }
    setTimeout(() => { videos.set(4, "seg-4.mp4"); readyOf(4).resolve(); }, 20);
    await expect(readSegment(table, videos, 4)).rejects.toThrow("第5段缺少对应备料");
  });
});
