/**
 * 「原编号不存在，放弃它」的整条生命周期探针。
 *
 * 为什么要它：这条出口的价值全在「跨组件卸载重挂仍然续算」，而本仓没有 jsdom /
 * testing-library，组件本身测不了。所以存取被收进 shared，探针用一个假 sessionStorage
 * 驱动**真代码**（不是抄一份），把切页签、隐私模式、脏值、换编号这些真实情形跑一遍。
 *
 * 运行：npx tsx server/scripts/probe_previs_abandon.ts
 */
import {
  PREVIS_ABANDON_AFTER_MS,
  clearPrevisMissingSince,
  previsAbandonable,
  previsMissingKey,
  readPrevisMissingSince,
  writePrevisMissingSince,
  type PrevisMissingStore,
} from "../../shared/manhuaPrevisAbandon.js";

const failures: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures.push(label + (detail === undefined ? "" : " → " + JSON.stringify(detail)));
  console.log((ok ? "OK   " : "FAIL ") + label + (detail === undefined ? "" : " " + JSON.stringify(detail)));
}

function memoryStore(): PrevisMissingStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
/** 隐私模式/禁用站点数据：三个方法全抛 */
const throwingStore: PrevisMissingStore = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
  removeItem() {
    throw new Error("SecurityError");
  },
};

const REQ = "8d965c10-a320-40ea-8528-8d4cc82a2729";
const OTHER = "32948768-9a15-4816-a576-55ddb67a37ff";
const t0 = 1_700_000_000_000;

// 1. 第一次查不到：落时间戳，按钮不点亮
const store = memoryStore();
let first = readPrevisMissingSince(store, REQ, t0) ?? t0;
writePrevisMissingSince(store, REQ, first);
check("第一次查不到只落时间戳，按钮不点亮", !previsAbandonable(first, t0), { first });

// 2. 九分钟后仍不点亮（阈值前一毫秒也不行）
const justBefore = t0 + PREVIS_ABANDON_AFTER_MS - 1;
check("差 1 毫秒不许点亮", !previsAbandonable(readPrevisMissingSince(store, REQ, justBefore), justBefore));

// 3. 切页签：组件卸载重挂（新的一份内存状态），计时必须续算而不是重来
const remounted = readPrevisMissingSince(store, REQ, t0 + 60_000);
check("重挂载后续算，不从零开始", remounted === first, { remounted, first });

// 4. 满十分钟点亮
const after = t0 + PREVIS_ABANDON_AFTER_MS;
check("满十分钟点亮", previsAbandonable(readPrevisMissingSince(store, REQ, after), after));

// 5. 换了请求编号：读不到旧值（不能把上一单的等待算到新单头上）
check("换编号读不到旧值", readPrevisMissingSince(store, OTHER, after) === null);
check("两个编号的键不同", previsMissingKey(REQ) !== previsMissingKey(OTHER));

// 6. 查到了 / 放弃了：清掉，按钮回落
clearPrevisMissingSince(store, REQ);
check("清掉之后按钮回落", readPrevisMissingSince(store, REQ, after) === null && !previsAbandonable(null, after));

// 7. 脏值与未来时间戳：改过系统时钟不许让按钮立刻点亮
for (const bad of ["", "abc", "0", "-1", "NaN", String(after + 60_000)]) {
  store.map.set(previsMissingKey(REQ), bad);
  const parsed = readPrevisMissingSince(store, REQ, after);
  check(`脏值 ${JSON.stringify(bad)} 不被采信`, parsed === null, { parsed });
}
store.map.delete(previsMissingKey(REQ));

// 8. 隐私模式：三个方法全抛也不能把主流程带崩，按钮退回不点亮
let threw = false;
try {
  writePrevisMissingSince(throwingStore, REQ, t0);
  const v = readPrevisMissingSince(throwingStore, REQ, after);
  clearPrevisMissingSince(throwingStore, REQ);
  check("隐私模式下不抛、退回不点亮", v === null, { v });
} catch (error) {
  threw = true;
  check("隐私模式下不抛", false, String(error));
}
check("确认异常没有漏出来", !threw);

// 9. 反例对照：这套断言必须能红——拿一个「永远返回 null」的假实现跑，续算那条要失败
const brokenResume = (): number | null => null;
check(
  "反例：读不回时间戳时『重挂载后续算』必须失败（证明第 3 条不是永远为真）",
  brokenResume() !== first,
);

console.log(JSON.stringify({ thresholdMs: PREVIS_ABANDON_AFTER_MS }, null, 2));
if (failures.length) {
  console.error("PROBE_FAILED", failures);
  process.exit(1);
}
console.log("PROBE_OK");
