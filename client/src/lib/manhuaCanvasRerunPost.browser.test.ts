/**
 * 0914 收口要求：浏览器里的**真实重跑 POST 对照**。
 *
 * 流程完全按审查给的：改变设置 → 重新确认 → 点真实画布重跑 → POST 与本次确认一致。
 * 夹具预置「已铺段、静帧就绪」的离线画布（纯本地计算），
 * 不跑反推、不生成、不付费；所有 fetch 被接管。
 *
 * 预览与确认调的是**真实页面**的 onPreviewClipOutbound / onConfirmClipOutbound
 * （通过 probe 壳从真实 OmniCanvas 的 props 拿到），不是测试自己重写一遍。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let bundle: string;

beforeAll(async () => {
  const result = await build({
    entryPoints: ["client/src/lib/manhuaCanvasRerunPost.fixture.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: {
      "@": `${process.cwd()}/client/src`,
      "@shared": `${process.cwd()}/shared`,
      "@/components/canvas/FreeformCanvas": `${process.cwd()}/client/src/lib/__browserfixtures__/freeformCanvasProbe.tsx`,
      "@/components/ManhuaScriptWorkbench": `${process.cwd()}/client/src/lib/__browserfixtures__/manhuaWorkbenchProbe.tsx`,
    },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".css": "text" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "__VITE_ENV__" },
    banner: { js: 'var __VITE_ENV__ = {DEV:false,PROD:true,MODE:"production",SSR:false};' },
    logLevel: "silent",
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ args: ["--no-sandbox"] });
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

/** 每个用例一个全新 BrowserContext：localStorage 隔离，第二条不沿用第一条的状态 */
async function mount(pilotBoundary = false): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setRequestInterception(true);
  p.on("request", (req) =>
    req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
  );
  await p.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await p.setContent("<div id=root></div>");
  await p.evaluate((enabled) => { (window as unknown as { __pilotBoundaryTest?: boolean }).__pilotBoundaryTest = enabled; }, pilotBoundary);
  await p.evaluate(bundle);
  await p.waitForFunction(() => /进入引导式漫剧/.test(document.body.innerText), { timeout: 30_000 });
  await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find(
      (e) => /进入引导式漫剧/.test(e.textContent || "") && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await p.waitForFunction(
    () => Boolean((window as never as { __ffcProps?: unknown }).__ffcProps) && Boolean((window as unknown as { __wbProps?: unknown }).__wbProps),
    { timeout: 30_000 },
  );
  return { page: p, close: async () => { await ctx.close().catch(() => {}); } };
}

describe("浏览器真实链路：确认 → 点真实画布重跑 → POST 与确认一致", () => {
  it("预置画布里确实有已铺好的 clip 段节点", async () => {
    const { page, close } = await mount();
    const clipIds = await page.evaluate(() => {
      const props = (window as never as { __ffcProps?: { blocks: Array<{ id: string }> } }).__ffcProps!;
      return props.blocks.filter((b) => b.id.startsWith("clip-")).map((b) => b.id);
    });
    expect(clipIds.length, "夹具没铺出 clip 节点，后面的对照不作数").toBeGreaterThan(0);
    await close();
  }, 180_000);

  /**
   * 诊断更正：上一轮我拿「节点 id 里有 -auto-」当页面重铺的证据，**那是错的**——
   * 那个后缀是夹具自己调 ensureManhuaFragmentClips 时就带上的。
   * 正确做法是比较**挂载前后的同一个节点**，这条就是这么做的。
   */
  it("【观测】挂载前后对照同一节点，记录本地落盘/载入对段级字段的实际影响", async () => {
    const { page, close } = await mount();
    const diff = await page.evaluate(() => {
      type B = Record<string, unknown>;
      const seeded = (window as never as { __seeded?: { blocks: B[] } }).__seeded;
      const live = (window as never as { __ffcProps?: { blocks: B[] } }).__ffcProps!.blocks;
      if (!seeded) return { seededAvailable: false as const };
      const pick = (b: B) => ({
        videoModel: b.videoModel ?? null,
        seedance25WorkMode: b.seedance25WorkMode ?? null,
        refVideoUrl: b.refVideoUrl ?? null,
      });
      const rows = seeded.blocks
        .filter((b) => String(b.id).startsWith("clip-"))
        .map((before) => {
          const after = live.find((x) => x.id === before.id);
          return {
            id: String(before.id),
            found: Boolean(after),
            before: pick(before),
            after: after ? pick(after) : null,
          };
        });
      return { seededAvailable: true as const, rows };
    });

    expect(diff.seededAvailable, "夹具没留下种进去的原样，无法对照").toBe(true);
    if (!diff.seededAvailable) return;

    // 这条只做**观测**：把挂载前后的真实差异打出来，
    // **不预设哪种行为正确**——是否该保留编辑身份属于产品判断，不由测试先定。
    const missing = diff.rows.filter((r) => !r.found).map((r) => r.id);
    const changed = diff.rows.filter(
      (r) => JSON.stringify(r.before) !== JSON.stringify(r.after),
    );
    console.info(
      "[挂载前后对照] 丢失节点=" +
        JSON.stringify(missing) +
        " 字段变化=" +
        JSON.stringify(changed, null, 1),
    );
    // 唯一的断言：对照本身能做（种进去的原样可得、页面侧可读），
    // 否则后面基于它的任何结论都不作数。
    expect(diff.rows.length, "夹具没种出 clip 段，无法对照").toBeGreaterThan(0);
    await close();
  }, 180_000);

  /** 真实确认与画布按钮共用出站载荷；试片回执不得覆盖已有正片。 */
  it.each([false, true])("甲：真实画布按钮与确认一致（试片=%s）", async (pilotBoundary) => {
    const { page, close } = await mount(pilotBoundary);
    const result = await page.evaluate(async () => {
      type B = Record<string, unknown>;
      type WbProps = {
        onRerunKeyartsFromReverse?: () => void;
        onPreviewClipOutbound?: (id: string) => Promise<{ body: B; snapshotId: string }>;
        onConfirmClipOutbound?: (id: string, snapshotId: string) => Promise<void>;
      };
      const w = window as never as {
        __ffcProps?: { blocks: B[] };
        __wbProps?: WbProps;
        __posts?: Array<{ url: string; body: B }>;
        __confirms?: string[];
      };
      const blocksNow = () => w.__ffcProps!.blocks;
      const cap = <T,>(pr: Promise<T>, ms: number, tag: string) =>
        Promise.race([
          pr,
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`超时:${tag}`)), ms)),
        ]);
      /** 轮询等待真实状态，不用固定睡眠 */
      const until = async (fn: () => boolean, ms: number, tag: string) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          if (fn()) return;
          await new Promise((r) => setTimeout(r, 150));
        }
        throw new Error(`等不到:${tag}`);
      };

      // **每次都重新读最新的 wb**，不缓存。
      // 上一轮我把 wb 存成局部变量，重渲染后拿的还是旧回调——
      // 我据此说「逐张重出会互相冲掉」，那个结论因此**不成立**，已撤回。
      const wbNow = () => w.__wbProps;
      if (!wbNow()?.onPreviewClipOutbound || !wbNow()?.onConfirmClipOutbound) {
        return { step: "no-workbench-callbacks" as const };
      }
      const clip = blocksNow().find((b) => String(b.id).startsWith("clip-"));
      if (!clip) return { step: "no-clip" as const };

      // ①② 先试一次真实预览；不通过就走真实「按原稿重出静帧」入口一次性重出，
      // 再等**全部静帧真的完成**（轮询真实状态，不用固定睡眠）。
      //
      let preview: { body: B; snapshotId: string } | null = null;
      let lastPreviewErr = "";
      let neededKeyartRerun = false;
      try {
        preview = await cap(wbNow()!.onPreviewClipOutbound!(String(clip.id)), 30_000, "preview");
      } catch (e) {
        lastPreviewErr = String((e as Error)?.message || e);
      }

      if (!preview) {
        if (!wbNow()?.onRerunKeyartsFromReverse) return { step: "no-batch-keyart" as const };
        const beforeUrls = new Map(
          blocksNow()
            .filter((b) => String(b.id).startsWith("keyart-"))
            .map((b) => [String(b.id), String(b.outputUrl ?? "")] as const),
        );
        neededKeyartRerun = true;
        wbNow()!.onRerunKeyartsFromReverse!();
        try {
          await until(
            () => {
              const ks = blocksNow().filter((b) => String(b.id).startsWith("keyart-"));
              if (!ks.length) return false;
              if (ks.some((k) => k.status === "running")) return false;
              // 所有静帧都必须换过产出（页面会把回执落成本机 blob:）
              return ks.every((k) => {
                const url = String(k.outputUrl ?? "");
                return Boolean(url) && url !== (beforeUrls.get(String(k.id)) ?? "");
              });
            },
            120_000,
            "静帧批量重出完成",
          );
        } catch (e) {
          return {
            step: "keyart-not-done" as const,
            why: String((e as Error)?.message || e),
            confirms: w.__confirms ?? [],
            keyartsNow: blocksNow()
              .filter((x) => String(x.id).startsWith("keyart-"))
              .map((x) => ({ id: x.id, status: x.status, out: String(x.outputUrl ?? "").slice(0, 28) })),
          };
        }
        try {
          preview = await cap(wbNow()!.onPreviewClipOutbound!(String(clip.id)), 30_000, "preview");
        } catch (e) {
          return {
            step: "preview-failed" as const,
            why: String((e as Error)?.message || e) || lastPreviewErr,
          };
        }
      }

      // ③ 真实确认（预览已在上面用真实入口取到）
      try {
        await cap(wbNow()!.onConfirmClipOutbound!(String(clip.id), preview.snapshotId), 30_000, "confirm");
      } catch (e) {
        return { step: "confirm-failed" as const, why: String((e as Error)?.message || e) };
      }

      // ④ 精确点击该节点内文案为「运行」的按钮
      w.__posts!.length = 0;
      const card = document.querySelector(`[data-canvas-block-id="${String(clip.id)}"]`);
      if (!card) return { step: "no-card" as const };
      const runBtn = Array.from(card.querySelectorAll("button")).find(
        (btn) => (btn.textContent || "").trim() === "运行",
      ) as HTMLButtonElement | undefined;
      if (!runBtn) return { step: "no-run-button" as const };
      if (runBtn.disabled) return { step: "run-button-disabled" as const };
      const beforeRun = JSON.parse(JSON.stringify(blocksNow().find(b => b.id === clip.id)));
      runBtn.click();

      // ⑤ 等真实成片 POST 出现，同样不用固定睡眠
      const isClipPost = (p: { url: string }) => /[?&]op=/.test(p.url);
      try {
        await until(() => w.__posts!.some(isClipPost), 60_000, "成片 POST");
      } catch (e) {
        return { step: "no-post" as const, why: String((e as Error)?.message || e) };
      }

      await until(() => blocksNow().find(b => b.id === clip.id)?.status !== "running", 30_000, "生成回执落定");
      return {
        beforeRun, afterRun: blocksNow().find(b => b.id === clip.id),
        step: "done" as const,
        posts: w.__posts!.filter(isClipPost).map((p) => p.body),
        previewBody: preview.body,
        confirms: w.__confirms ?? [],
        neededKeyartRerun,
      };
    });

    if (result.step !== "done") console.info("[诊断] " + JSON.stringify(result, null, 1).slice(0, 2600));
    expect(
      result.step,
      `流程卡在：${result.step}${"why" in result ? " · " + String(result.why) : ""}`,
    ).toBe("done");
    if (result.step !== "done") return;
    // 只有真的走了重出路径时才要求弹过 confirm。
    // 静帧本来就 current 时不需要重出——那不是缺陷，是起始状态就合格。
    if (result.neededKeyartRerun) {
      expect(result.confirms.length, "走了重出路径却没弹 confirm").toBeGreaterThan(0);
    }
    expect(result.posts, "点了真实「运行」却没有成片 POST").toHaveLength(1);
    const strip = (x: Record<string, unknown>) => {
      const { idempotencyKey: _k, videoSubmissionKey: _s, intentId: _i, ...rest } = x;
      return rest;
    };
    expect(strip(result.posts[0]!)).toEqual(strip(result.previewBody));
    if (pilotBoundary) {
      expect(result.posts[0]!.duration).toBe(10);
      for (const key of ["prompt", "outputUrl", "outputUrls", "lastFrameUrl", "videoTaskId", "videoIntentId"]) {
        expect(result.afterRun?.[key], key).toEqual(result.beforeRun[key]);
      }
    }
    await close();
  }, 180_000);

  /**
   * ⚠️【未完成·必须补】刻意 skip，不是覆盖。卡点已定位，如实记录。
   *
   * 前半段是通的：确认 A → 改真实设置（走页面自己的 onShotContinuityChange）→
   * 点真实「运行」。
   *
   * 卡在后半段：重新预览 B 时报「多模态参考需要至少一张图片、一条视频或一条音频」。
   * 诊断到的状态是——本机媒体回灌之后，各**静帧**的 outputUrl 已换成 blob:，
   * 而该**段**节点的 refImageUrl 仍停在回灌前的 https 静帧地址，两边始终对不齐
   * （等了 30s 也没对齐）。段节点本身没坏：refImageUrl 与 5 条 editFusionUrls 都在。
   *
   * **是不是缺陷我没有判定**：也可能是这个离线夹具里图片抓取被拦成空响应、
   * 本机媒体记录没建立 source→pointer 映射所致。交给审查核实。
   * 它与 0915 修掉的那条（回执迁移漏了原镜）属于同一族问题：地址迁移时谁跟着走。
   */
  it("确认 A → 改设置为 B → 旧确认被拒 → 重新确认 B → 实际 POST 等于 B", async () => {
    // 这一条补的是「重渲染之后画布真的消费了**新**准备结果」。
    //
    // 用**第二段**：首段没有「上一段」，切尾帧接力未必改到请求，证明不了消费了新设置。
    // 设置走页面自己的 onShotContinuityChange——工作台那个接力开关点下去调的同一个函数；
    // 该开关在本夹具状态未渲染，所以直接调真实 prop，这个边界如实写在这里。
    // （曾试过用「导演包主卡」做 B：它会让该段丢掉静帧引用，太具破坏性，已弃用。）
    const { page, close } = await mount();
    const result = await page.evaluate(async () => {
      type B = Record<string, unknown>;
      type WbProps = {
        onPreviewClipOutbound?: (id: string) => Promise<{ body: B; snapshotId: string }>;
        onConfirmClipOutbound?: (id: string, snapshotId: string) => Promise<void>;
        onShotContinuityChange?: (next: {
          keyartFromPrevStill: boolean;
          clipFromPrevTail: boolean;
        }) => void;
        shotContinuity?: { keyartFromPrevStill: boolean; clipFromPrevTail: boolean };
      };
      const w = window as never as {
        __ffcProps?: { blocks: B[] };
        __wbProps?: WbProps;
        __posts?: Array<{ url: string; body: B }>;
      };
      const wbNow = () => w.__wbProps!;
      const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
      const isClipPost = (p: { url: string }) => /[?&]op=/.test(p.url);
      const until = async (fn: () => boolean, ms: number, tag: string) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          if (fn()) return true;
          await new Promise((r) => setTimeout(r, 150));
        }
        throw new Error(`等不到:${tag}`);
      };
      const staleErrors: string[] = [];
      const clickRun = (clipId: string) => {
        const card = document.querySelector(`[data-canvas-block-id="${clipId}"]`);
        if (!card) return "no-card";
        const btn = Array.from(card.querySelectorAll("button")).find(
          (x) => (x.textContent || "").trim() === "运行",
        ) as HTMLButtonElement | undefined;
        if (!btn) return "no-run-button";
        if (btn.disabled) return "run-button-disabled";
        btn.click();
        return "clicked";
      };

      // 段号（clip-e01-gNN-...）比节点 id 稳：改设置可能让页面重铺、换掉 id。
      const segOf = (id: string) => /^clip-e\d+-g(\d+)/.exec(id)?.[1] ?? "";
      // **用第二段**：首段没有「上一段」，切尾帧接力未必改到请求，
      // 那样就证明不了「消费了新设置」（0915 审查点名）。
      const clips = w.__ffcProps!.blocks
        .filter((x) => String(x.id).startsWith("clip-"))
        .sort((x, y) => Number(segOf(String(x.id))) - Number(segOf(String(y.id))));
      if (clips.length < 2) return { step: "need-two-clips" as const };
      const seg = segOf(String(clips[1]!.id));
      /** 每次都按段号重新定位，不复用旧 id */
      const clipIdNow = () =>
        String(
          w.__ffcProps!.blocks.find(
            (x) => String(x.id).startsWith("clip-") && segOf(String(x.id)) === seg,
          )?.id ?? "",
        );
      const clipId = clipIdNow();
      if (!clipId) return { step: "no-clip" as const };

      // ① 确认 A。
      // 挂载后本机媒体回灌还在跑，预览与确认之间内容会变（确认就会被正确地拒掉）。
      // 所以先等**快照稳定**：连续两次预览拿到同一个 snapshotId 才算落定。
      let a: { body: B; snapshotId: string };
      try {
        const t0 = Date.now();
        let prev = await wbNow().onPreviewClipOutbound!(clipId);
        for (;;) {
          await settle(500);
          const cur = await wbNow().onPreviewClipOutbound!(clipId);
          if (cur.snapshotId === prev.snapshotId) {
            a = cur;
            break;
          }
          prev = cur;
          if (Date.now() - t0 > 30_000) throw new Error("等不到:预览快照稳定");
        }
        await wbNow().onConfirmClipOutbound!(clipId, a.snapshotId);
      } catch (e) {
        return { step: "confirm-a-failed" as const, why: String((e as Error)?.message || e) };
      }
      await settle(300);

      // ② 改设置为 B：走真实页面的「镜间接力」设置回调。
      //    这正是工作台那个接力开关点下去会调的同一个函数（本夹具状态下该开关未渲染，
      //    所以直接调它的真实 prop，而不是另写一套改状态的办法）。
      //    shotContinuity 同时是 prepareManhuaClipRunInput 的依赖之一。
      //    只翻「上一段尾帧接力」这一项：两项都翻会把参考图一起清掉，
      //    预览直接报「多模态参考需要至少一张图片…」，那是夹具用错设置，不是缺陷。
      const before = wbNow().shotContinuity ?? {
        keyartFromPrevStill: true,
        clipFromPrevTail: true,
      };
      if (!wbNow().onShotContinuityChange) return { step: "no-setting-control" as const };
      wbNow().onShotContinuityChange!({
        keyartFromPrevStill: before.keyartFromPrevStill,
        clipFromPrevTail: !before.clipFromPrevTail,
      });
      await settle(1000);

      const snapBlock = w.__ffcProps!.blocks.find((x) => String(x.id) === clipIdNow());
      const snapshotBefore = snapBlock
        ? {
            id: snapBlock.id,
            status: snapBlock.status,
            refImageUrl: snapBlock.refImageUrl ?? null,
            editFusionUrls: (snapBlock.editFusionUrls as unknown[] | undefined)?.length ?? 0,
            outputUrl: snapBlock.outputUrl ?? null,
          }
        : null;

      // ③ 旧确认必须被拒，且零 POST（按段号重新定位节点）
      const clipAfterChange = clipIdNow();
      if (!clipAfterChange) return { step: "clip-gone-after-setting" as const };
      w.__posts!.length = 0;
      const clicked1 = clickRun(clipAfterChange);
      if (clicked1 !== "clicked") return { step: "run-a-failed" as const, why: clicked1 };
      // 轮询本次运行的终态，不用固定睡眠
      try {
        await until(
          () => {
            const c = w.__ffcProps!.blocks.find((x) => String(x.id) === clipAfterChange);
            const st = String((c as B | undefined)?.status ?? "");
            return st !== "running" && Boolean((c as B | undefined)?.error);
          },
          30_000,
          "旧确认那次运行落定",
        );
      } catch (e) {
        return { step: "stale-run-not-settled" as const, why: String((e as Error)?.message || e) };
      }
      const postsAfterStale = w.__posts!.filter(isClipPost).length;
      // 失败原因会被 patchOne 写进节点的 error 字段，直接读它，比拦 toast 稳
      const afterStale = w.__ffcProps!.blocks.find((x) => String(x.id) === clipAfterChange);
      const staleReason = String((afterStale as B | undefined)?.error ?? "");
      if (staleReason) staleErrors.push(staleReason);

      // ④ 重新确认 B
      // 不再需要「等段参考与静帧产出对齐」那道权宜等待：
      // 0915 修掉「本机参考被提前过滤」之后，准备器会自己把 blob:/local-media:
      // 溯源回 https，参考不会再被丢。
      let bPrev: { body: B; snapshotId: string };
      try {
        bPrev = await wbNow().onPreviewClipOutbound!(clipAfterChange);
        await wbNow().onConfirmClipOutbound!(clipAfterChange, bPrev.snapshotId);
      } catch (e) {
        const pick = (x: B | undefined) =>
          x
            ? {
                id: x.id,
                status: x.status,
                refImageUrl: x.refImageUrl ?? null,
                editFusionUrls: (x.editFusionUrls as unknown[] | undefined)?.length ?? 0,
                outputUrl: x.outputUrl ?? null,
              }
            : null;
        return {
          step: "confirm-b-failed" as const,
          why: String((e as Error)?.message || e),
          clipBefore: snapshotBefore,
          clipAfter: pick(w.__ffcProps!.blocks.find((x) => String(x.id) === clipAfterChange)),
          keyartsAfter: w.__ffcProps!.blocks
            .filter((x) => String(x.id).startsWith("keyart-"))
            .slice(0, 3)
            .map((x) => ({ id: x.id, status: x.status, out: String(x.outputUrl ?? "").slice(0, 30) })),
        };
      }
      await settle(300);

      // ⑤ 再点运行，抓真实 POST
      w.__posts!.length = 0;
      // 上一次被拒的运行可能还没落定，按钮仍 disabled；等它可点再点（不用固定睡眠）
      try {
        await until(
          () => {
            const card = document.querySelector(`[data-canvas-block-id="${clipAfterChange}"]`);
            const btn = card
              ? (Array.from(card.querySelectorAll("button")).find(
                  (x) => (x.textContent || "").trim() === "运行",
                ) as HTMLButtonElement | undefined)
              : undefined;
            return Boolean(btn && !btn.disabled);
          },
          30_000,
          "运行按钮恢复可点",
        );
      } catch (e) {
        return { step: "run-b-blocked" as const, why: String((e as Error)?.message || e) };
      }
      const clicked2 = clickRun(clipAfterChange);
      if (clicked2 !== "clicked") return { step: "run-b-failed" as const, why: clicked2 };
      try {
        await until(() => w.__posts!.some(isClipPost), 60_000, "B 的成片 POST");
      } catch (e) {
        return { step: "no-post-b" as const, why: String((e as Error)?.message || e) };
      }

      return {
        step: "done" as const,
        settingChanged:
          JSON.stringify(wbNow().shotContinuity ?? null) !== JSON.stringify(before),
        postsAfterStale,
        staleErrors,
        bodyA: a.body,
        bodyB: bPrev.body,
        posts: w.__posts!.filter(isClipPost).map((p) => p.body),
      };
    });

    if (result.step !== "done") console.info("[诊断AB] " + JSON.stringify(result, null, 1).slice(0, 2600));
    expect(
      result.step,
      `流程卡在：${result.step}${"why" in result ? " · " + String(result.why) : ""}`,
    ).toBe("done");
    if (result.step !== "done") return;

    const strip = (x: Record<string, unknown>) => {
      const { idempotencyKey: _k, videoSubmissionKey: _s, intentId: _i, ...rest } = x;
      return rest;
    };
    // 设置真的改了，A 与 B 的出站内容必须不同——否则这条没有证明力
    expect(result.settingChanged, "设置没真的改到页面状态，这条用例不作数").toBe(true);
    expect(
      strip(result.bodyB),
      "改设置之后出站内容没变，这条用例证明不了任何事",
    ).not.toEqual(strip(result.bodyA));
    // 零 POST 不等于确认闸生效：必须是**确认失效**这个原因拒的，
    // 排除缺参考、其它异常或还在等待（0915 审查点名）。
    expect(
      result.staleErrors.join("｜"),
      `旧确认被拒的原因不是「确认失效」：${result.staleErrors.join("｜") || "（没有任何错误，可能只是还没跑）"}`,
    ).toMatch(/在确认之后发生了变化|确认记录属于另一个|还没有完成生成前确认|工作区在你确认之后被重新载入过/);
    expect(result.postsAfterStale, "旧确认在设置改变后仍然发出了请求").toBe(0);
    // 重新确认之后，真正发出去的就是 B
    expect(result.posts).toHaveLength(1);
    expect(strip(result.posts[0]!)).toEqual(strip(result.bodyB));
    await close();
  }, 180_000);
});
