/**
 * PR-B 探针：用一台假 Fly Machines API 跑完整条启停链路。
 *
 * 跑的是真代码（resolveRigAutoscaleDeps → listRigMachines → start/stop），真 HTTP 往返，
 * 真 Authorization 头；假的只有对面那台服务器。
 *
 * 能证明：请求方法/URL/鉴权头对不对、只挑 rig 进程组的停机机器、app 机一次都不碰、
 * 停机命令发出前领单闸先关、没凭证时一个请求都不发、Fly 报错不抛进 worker 循环。
 * **不能证明**：真实 Fly API 会接受这些请求（那需要生产 token，只在 Fly env，不下本机）。
 *
 * 运行：npx tsx server/scripts/probe_rig_autoscale.ts
 */
import { createServer } from "node:http";
import {
  RIG_UNAVAILABLE_CONFIRM_MS,
  ensureRigStartedForPending,
  maybeStopIdleRig,
  resolveRigAutoscaleDeps,
  type RigStartState,
} from "../jobs/rigAutoscale.js";

type Call = { method: string; path: string; auth: string };
const calls: Call[] = [];
let machines = [
  { id: "app-1", state: "started", config: { metadata: { fly_process_group: "app" } } },
  { id: "rig-1", state: "stopped", config: { metadata: { fly_process_group: "rig" } } },
];
/** 只让 /stop 这一个请求失败：原来是「下一个请求失败」，结果 502 落在停机前的
 *  进程组核对上，那条断言验的根本不是停机失败路径（自证嫌疑，第二轮审查抓的）。 */
let failNextStop = false;
/** 让列举返回 200 + 非数组体（代理页 / 错误体），验「畸形响应不许当成没有机器」。 */
let malformedList = false;

const server = createServer((req, res) => {
  calls.push({ method: req.method || "", path: req.url || "", auth: String(req.headers.authorization || "") });
  const start = /\/machines\/([^/]+)\/start$/.exec(req.url || "");
  const stop = /\/machines\/([^/]+)\/stop$/.exec(req.url || "");
  if (stop && failNextStop) {
    failNextStop = false;
    res.writeHead(502).end("upstream boom");
    return;
  }
  if (start) {
    machines = machines.map((m) => (m.id === start[1] ? { ...m, state: "started" } : m));
    res.writeHead(200).end(JSON.stringify({ ok: true }));
    return;
  }
  if (stop) {
    machines = machines.map((m) => (m.id === stop[1] ? { ...m, state: "stopped" } : m));
    res.writeHead(200).end(JSON.stringify({ ok: true }));
    return;
  }
  if (malformedList) {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(machines));
});

const failures: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures.push(label + (detail === undefined ? "" : " → " + JSON.stringify(detail)));
  console.log((ok ? "OK   " : "FAIL ") + label + (detail === undefined ? "" : " " + JSON.stringify(detail)));
}

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const env = {
    FLY_API_TOKEN: "probe-only-not-a-real-token",
    FLY_APP_NAME: "mvstudiopro-probe",
    FLY_MACHINE_ID: "rig-1",
    FLY_MACHINES_API_URL: `http://127.0.0.1:${port}/v1`,
    MANHUA_RIG_IDLE_STOP_MS: "60000",
  } as unknown as NodeJS.ProcessEnv;

  let queued = 0;
  let running = 0;
  let gateClosed = false;
  const counters = {
    queuedBlenderJobs: async () => queued,
    pendingBlenderJobs: async () => queued + running,
  };
  const hooks = {
    onStopDecided: () => {
      gateClosed = true;
    },
    onStopAborted: () => {
      gateClosed = false;
    },
  };
  const deps = resolveRigAutoscaleDeps(counters, hooks, env)!;
  check("有凭证时能装配依赖", Boolean(deps));

  // 1. 队列为空：一个请求都不该发
  const startState = { lastAttemptAt: 0 };
  const idleOut0 = await ensureRigStartedForPending(deps, startState);
  check("队列为空不发请求", idleOut0.action === "idle" && calls.length === 0, { action: idleOut0.action, calls: calls.length });

  // 2. 有排队任务：只启动 rig 机
  queued = 1;
  const started = await ensureRigStartedForPending(deps, startState);
  check("启动了 rig 机", started.action === "started", started);
  check("只碰 rig-1，app 机一次没碰", calls.every((c) => !c.path.includes("app-1")) && calls.some((c) => c.path.endsWith("/machines/rig-1/start")), calls.map((c) => c.method + " " + c.path));
  check("鉴权头是 Bearer 且带上了 token", calls.every((c) => c.auth === "Bearer probe-only-not-a-real-token"));
  check("机器状态已变 started", machines.find((m) => m.id === "rig-1")?.state === "started");

  // 3. 已经在跑：不重复发启动命令（先跨过冷却）
  const before = calls.length;
  startState.lastAttemptAt = 0;
  const again = await ensureRigStartedForPending(deps, startState);
  check("已 started 不重复发启动", again.action === "already_running" && !calls.slice(before).some((c) => c.path.endsWith("/start")), again);

  // 4. 任务在跑时不停机
  queued = 0;
  running = 1;
  const idleState = { lastBusyAt: Date.now() - 10 * 60_000 };
  const busy = await maybeStopIdleRig(deps, idleState, () => false);
  check("队列里还有任务就不停机", busy.action === "busy" && !gateClosed, busy);

  // 5. 真正空闲：关闸 → 停机
  running = 0;
  idleState.lastBusyAt = Date.now() - 10 * 60_000;
  const stopped = await maybeStopIdleRig(deps, idleState, () => false);
  check("空闲够久停掉自己这台", stopped.action === "stopped" && stopped.machineId === "rig-1", stopped);
  check("停机前领单闸已关", gateClosed);
  check("机器状态已变 stopped", machines.find((m) => m.id === "rig-1")?.state === "stopped");

  // 5b. 停机窗口竞态：关闸那一刻本进程刚领到一单 → 必须撤回停机，一个 stop 都不许发
  machines = machines.map((m) => (m.id === "rig-1" ? { ...m, state: "started" } : m));
  gateClosed = false;
  let localBusy = false;
  const raceDeps = resolveRigAutoscaleDeps(counters, {
    onStopDecided: () => {
      gateClosed = true;
      localBusy = true; // 闸关上的同一刻，post_prod 通道已经在上一次 await 期间领到了单
    },
    onStopAborted: () => {
      gateClosed = false;
    },
  }, env)!;
  const stopsBeforeRace = calls.filter((c) => c.path.endsWith("/stop")).length;
  const raced = await maybeStopIdleRig(raceDeps, { lastBusyAt: Date.now() - 10 * 60_000 }, () => localBusy);
  check(
    "关闸后发现本进程刚领到一单：撤回停机、闸复位、一个 stop 都没发",
    raced.action === "busy" && !gateClosed && calls.filter((c) => c.path.endsWith("/stop")).length === stopsBeforeRace,
    raced,
  );

  // 6. Fly 报错：不抛出，闸复位
  machines = machines.map((m) => (m.id === "rig-1" ? { ...m, state: "started" } : m));
  gateClosed = false;
  failNextStop = true;
  idleState.lastBusyAt = Date.now() - 10 * 60_000;
  const stopsBeforeFail = calls.filter((c) => c.path.endsWith("/stop")).length;
  const failed = await maybeStopIdleRig(deps, idleState, () => false);
  check(
    "停机命令真发出去并被 502 拒绝：只报不抛、闸已复位",
    failed.action === "error" &&
      failed.message.includes("停机失败") &&
      !gateClosed &&
      calls.filter((c) => c.path.endsWith("/stop")).length === stopsBeforeFail + 1,
    failed,
  );

  // 7. 没凭证：一个请求都不发（关闭式失败）
  const beforeNoToken = calls.length;
  const none = resolveRigAutoscaleDeps(counters, hooks, { FLY_APP_NAME: "x" } as unknown as NodeJS.ProcessEnv);
  check("没有 token 就没有依赖，也没有请求", none === null && calls.length === beforeNoToken);

  // 8. 反例对照（这条探针必须能红）：把本机 ID 换成 app 机，停机必须被拒绝
  machines = machines.map((m) => (m.id === "rig-1" ? { ...m, state: "started" } : m));
  const wrongSelf = resolveRigAutoscaleDeps(counters, hooks, { ...env, FLY_MACHINE_ID: "app-1" })!;
  const beforeWrong = calls.filter((c) => c.path.includes("app-1")).length;
  const refused = await maybeStopIdleRig(wrongSelf, { lastBusyAt: Date.now() - 10 * 60_000 }, () => false);
  check(
    "本机不在 rig 进程组时拒绝停机，且没对 app 机发过任何命令",
    refused.action === "error" && calls.filter((c) => c.path.includes("app-1")).length === beforeWrong,
    refused,
  );

  // 9. 行为变更验证：一台 rig 机都没有时，排队中的 Blender 任务即时打回并带可执行命令
  const failedReasons: string[] = [];
  machines = machines.filter((m) => m.config.metadata.fly_process_group !== "rig");
  const failing = resolveRigAutoscaleDeps(
    counters,
    {
      ...hooks,
      failQueuedBlenderJobs: async (reason: string) => {
        failedReasons.push(reason);
        return ["job-x"];
      },
    },
    env,
  )!;
  queued = 1;
  // 9a. 反例对照：第一次看见「零台 rig」只记录不打回（fly deploy 期间零台 rig 是暂态）
  const failState: RigStartState = { lastAttemptAt: 0 };
  const firstLook = await ensureRigStartedForPending(failing, failState);
  check(
    "首次观察到零台 rig 机：只记录，一个任务都不许打回",
    firstLook.action === "no_machine_pending" && failedReasons.length === 0,
    { action: firstLook.action, failed: failedReasons.length },
  );

  // 9b. 确认窗口走满（把状态里的起始时间往前拨，状态本来就归调用方所有）
  failState.unavailableSince = Date.now() - RIG_UNAVAILABLE_CONFIRM_MS - 1;
  const noMachine = await ensureRigStartedForPending(failing, failState);
  check(
    "连续确认够久后打回排队任务，错误带用户向说明和管理员命令",
    noMachine.action === "no_machine" &&
      failedReasons.length === 1 &&
      failedReasons[0].includes("Blender 后期机不存在或不可唤醒") &&
      failedReasons[0].includes("不是你的参数或配置问题") &&
      failedReasons[0].includes("fly scale count rig=1 -a mvstudiopro-probe"),
    failedReasons,
  );

  // 10. 反例对照：列举返回 200 但不是数组（代理/错误体）——必须报错，绝不当成「没有机器」去打回
  const before10 = failedReasons.length;
  malformedList = true;
  const malformed = await ensureRigStartedForPending(failing, {
    lastAttemptAt: 0,
    unavailableSince: Date.now() - RIG_UNAVAILABLE_CONFIRM_MS - 1,
  });
  malformedList = false;
  check(
    "列举返回畸形响应：报 error、不打回任何任务",
    malformed.action === "error" && malformed.message.includes("列举 rig 机失败") && failedReasons.length === before10,
    malformed,
  );

  // 11. 反例对照（第五轮）：零台 rig，但应用里有缺 fly_process_group 元数据的机器（fly machine run 手建）
  //     —— 手建机很可能正带着 JOB_WORKER_ROLE=rig 在领单，这时候打回等于一边有机器在跑一边杀队列。
  const before11 = failedReasons.length;
  machines = [{ id: "hand-built", state: "started", config: { metadata: { fly_process_group: "" } } }];
  const unknown = await ensureRigStartedForPending(failing, {
    lastAttemptAt: 0,
    unavailableSince: Date.now() - RIG_UNAVAILABLE_CONFIRM_MS - 1,
  });
  check(
    "零台 rig 但有机器缺进程组元数据：证据不足，一个任务都不打回",
    unknown.action === "unknown_topology" && failedReasons.length === before11,
    unknown,
  );

  server.close();
  console.log(JSON.stringify({ httpCalls: calls.map((c) => c.method + " " + c.path) }, null, 2));
  if (failures.length) {
    console.error("PROBE_FAILED", failures);
    process.exit(1);
  }
  console.log("PROBE_OK");
}

void main().catch((error) => {
  console.error("PROBE_FAILED", error);
  process.exit(1);
});
