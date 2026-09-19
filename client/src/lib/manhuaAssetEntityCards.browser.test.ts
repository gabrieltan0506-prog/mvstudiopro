/**
 * 资产页实体卡的**真实浏览器验收**（离线 puppeteer，挂真实 ManhuaScriptWorkbench）。
 *
 * 为什么必须走浏览器：分组是 UI 收口，纯函数测试只能证明数据对，
 * 证明不了「用户在页面上看到的是一组一张卡、同一张图没被画两次」。
 * 全部 fetch 被拦截，不生成、不付费、不连生产。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle: string;
/**
 * 分镜阶段的第二份夹具：资产阶段只有工具条一个位置会画静帧按钮，
 * 拿它断言「恰好一个」是**永真的**（变异掉让位逻辑仍然绿 —— 实测过）。
 * 重复只可能出现在两处同时具备的阶段，所以必须另挂一份分镜阶段的页面。
 */
let storyboardBundle: string;

const REFS = [
  { id: "a1", url: "data:image/png;base64,iVBORw0KGgo=", role: "character", source: "generated", labelZh: "阿菁-候选", claimedAnchorIds: ["wa_char_aqing"] },
  { id: "a2", url: "data:image/png;base64,iVBORw0KGgo=", role: "character", source: "generated", labelZh: "阿菁-定妆", refDuty: "identity", claimedAnchorIds: ["wa_char_aqing"], primaryBindings: [{ anchorId: "wa_char_aqing", duty: "identity" }] },
  { id: "a3", url: "data:image/png;base64,iVBORw0KGgo=", role: "character", source: "generated", labelZh: "阿菁-编辑", claimedAnchorIds: ["wa_char_aqing"] },
  { id: "duo", url: "data:image/png;base64,iVBORw0KGgo=", role: "character", source: "generated", labelZh: "阿菁与墨菁合影", claimedAnchorIds: ["wa_char_aqing", "wa_char_mo"] },
  { id: "z9", url: "data:image/png;base64,iVBORw0KGgo=", role: "character", source: "upload", labelZh: "网图-没认领" },
];

const CANON = {
  characters: [
    { id: "wa_char_aqing", role: "character", nameZh: "阿菁", lookZh: "" },
    { id: "wa_char_mo", role: "character", nameZh: "墨菁", lookZh: "" },
  ],
  locations: [],
  props: [],
};

beforeAll(async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { TooltipProvider } from './client/src/components/ui/tooltip';
        import ManhuaScriptWorkbench from './client/src/components/ManhuaScriptWorkbench';
        globalThis.fixture = { keyart: 0, openedIssue: undefined };
        const refs = ${JSON.stringify(REFS)};
        const canon = ${JSON.stringify(CANON)};
        createRoot(document.getElementById('root')).render(
          <TooltipProvider>
            <ManhuaScriptWorkbench
              blocks={[]} videoModel='seedance-2.5' topic='墨屠守护阿菁'
              episodeCount={1} focusEpisode={1} onFocusEpisode={() => {}}
              characterIds={[]} propIds={[]} outlineConfirmed={true}
              workflowPhase='assets' customAssetRefs={refs} assetCanon={canon}
              onUploadCustomAssets={async () => {}}
              onGenerateAllEpisodeKeyarts={async () => { globalThis.fixture.keyart += 1; }}
              onGenerateAsset3d={async () => {}}
              onUpdateClipPrevisStudio={() => {}}
              onChangeManhuaActionPlan={() => {}}
              onUpdateClipAudioStudio={() => {}}
              advisorIssues={[
                { id: 'keyframe', text: '关键静帧还没垫图锁定，成片会走纯文生成', phase: 'storyboard', blocking: true },
                { id: 'asset-gap', text: '阿菁还没有定妆图，静帧锁不到这张脸', phase: 'assets', blocking: true },
                { id: 'claims', text: '2 张人物图未认领，静帧不会拿它们当参考', phase: 'assets', blocking: false },
              ]}
              onOpenAdvisorIssue={(id) => { globalThis.fixture.openedIssue = id || null; }}
            />
          </TooltipProvider>,
        );
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".css": "text" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "__VITE_ENV__" },
    banner: {
      js:
        'var __VITE_ENV__={DEV:false,PROD:true,MODE:"production",SSR:false};' +
        'window.matchMedia=window.matchMedia||function(){return{matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}};',
    },
    logLevel: "silent",
  });
  bundle = built.outputFiles[0]!.text;

  const storyboardBuilt = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { TooltipProvider } from './client/src/components/ui/tooltip';
        import { defaultCanvasBlock } from './client/src/lib/canvasTypes';
        import ManhuaScriptWorkbench from './client/src/components/ManhuaScriptWorkbench';
        globalThis.fixture = { keyart: 0, openedIssue: undefined };
        const refs = ${JSON.stringify(REFS)};
        const canon = ${JSON.stringify(CANON)};
        const blocks = [1, 2].map((n) => ({
          ...defaultCanvasBlock('video', 0, 0),
          id: 'clip-e01-g0' + n + '-cards',
          episodeIndex: 1,
          videoModel: 'seedance-2.5',
          prompt: '【第' + n + '段·30s】墨屠第' + n + '段动作。',
        }));
        createRoot(document.getElementById('root')).render(
          <TooltipProvider>
            <ManhuaScriptWorkbench
              blocks={blocks} videoModel='seedance-2.5' topic='墨屠守护阿菁'
              episodeCount={1} focusEpisode={1} onFocusEpisode={() => {}}
              characterIds={[]} propIds={[]} outlineConfirmed={true}
              workflowPhase='storyboard' compactUi={false}
              customAssetRefs={refs} assetCanon={canon}
              onUploadCustomAssets={async () => {}}
              onGenerateAllEpisodeKeyarts={async () => { globalThis.fixture.keyart += 1; }}
              onGenerateAsset3d={async () => {}}
              onUpdateClipPrevisStudio={() => {}}
              onChangeManhuaActionPlan={() => {}}
              onUpdateClipAudioStudio={() => {}}
            />
          </TooltipProvider>,
        );
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".css": "text" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "__VITE_ENV__" },
    banner: {
      js:
        'var __VITE_ENV__={DEV:false,PROD:true,MODE:"production",SSR:false};' +
        'window.matchMedia=window.matchMedia||function(){return{matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}};',
    },
    logLevel: "silent",
  });
  storyboardBundle = storyboardBuilt.outputFiles[0]!.text;

  browser = await puppeteer.launch({ args: ["--no-sandbox"] });
}, 180_000);

afterAll(async () => {
  await browser?.close();
}, 180_000);

async function mountStoryboard(): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) =>
    req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
  );
  await page.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.setContent("<div id=root></div>");
  // compactUi 是组件内部 state（localStorage `manhua_compact_ui`，默认 true），不是 prop。
  // 关掉简洁模式才会同时具备「工具条 + 分镜面板」两个静帧入口 —— 这是真能出现重复的那个状态，
  // 旧代码在这里就是两个按钮。
  await page.evaluate(() => window.localStorage.setItem("manhua_compact_ui", "0"));
  await page.evaluate(storyboardBundle);
  await page.waitForFunction(() => /生成关键静帧|视觉简报|分镜/.test(document.body.innerText), {
    timeout: 30_000,
  });
  return { page, close: async () => { await ctx.close().catch(() => {}); } };
}

async function mount(): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) =>
    req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
  );
  await page.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.setContent("<div id=root></div>");
  await page.evaluate(bundle);
  await page.waitForSelector("[data-manhua-custom-refs-role=character]", { timeout: 30_000 });
  return { page, close: async () => { await ctx.close().catch(() => {}); } };
}

describe("浏览器真实页面：资产页同名多版本收成实体卡", () => {
  it("人物栏按实体分组，组头报当前采用的职责，计数报实体数与张数", async () => {
    const { page, close } = await mount();
    const seen = await page.evaluate(() => {
      const section = document.querySelector("[data-manhua-custom-refs-role=character]")!;
      const groups = Array.from(section.querySelectorAll("[data-manhua-asset-entity]"));
      return {
        headerText: (section.querySelector("button")?.textContent || "").replace(/\s+/g, " ").trim(),
        groups: groups.map((g) => ({
          key: g.getAttribute("data-manhua-asset-entity"),
          hasCurrent: g.getAttribute("data-manhua-asset-entity-current"),
          currentZh: g.querySelector("[data-manhua-asset-entity-current-zh]")?.textContent?.trim() || "",
          cardIds: Array.from(g.querySelectorAll("[data-manhua-asset-card-toggle]")).map((b) =>
            b.getAttribute("data-manhua-asset-card-toggle"),
          ),
        })),
      };
    });
    // 栏头：实体数与图片数分开报，不再只报一个 18
    expect(seen.headerText).toContain("2 个人物 · 5 张图");
    // 缺当前版本的实体排最前（墨菁只有一张合影、没定当前版本）
    expect(seen.groups.map((g) => g.key)).toEqual(["wa_char_mo", "wa_char_aqing", "__unclaimed"]);
    const mo = seen.groups[0]!;
    const aqing = seen.groups[1]!;
    expect(mo.hasCurrent).toBe("0");
    expect(mo.currentZh).toBe("未定当前版本");
    expect(aqing.hasCurrent).toBe("1");
    expect(aqing.currentZh).toBe("当前：锁脸（妆造未定）");
    await close();
  }, 180_000);

  it("同一张图不会在页面上被画两次，未认领的图单独一组并写明不参与出片", async () => {
    const { page, close } = await mount();
    const seen = await page.evaluate(() => {
      const section = document.querySelector("[data-manhua-custom-refs-role=character]")!;
      const cards = Array.from(section.querySelectorAll("[data-manhua-asset-card-toggle]")).map((b) =>
        b.getAttribute("data-manhua-asset-card-toggle"),
      );
      const unclaimed = section.querySelector('[data-manhua-asset-entity="__unclaimed"]')!;
      return {
        cards,
        unclaimedText: (unclaimed.textContent || "").replace(/\s+/g, " "),
        unclaimedCards: Array.from(unclaimed.querySelectorAll("[data-manhua-asset-card-toggle]")).map((b) =>
          b.getAttribute("data-manhua-asset-card-toggle"),
        ),
      };
    });
    // 合影 duo 被两个人物认领，但全栏只出现一次（卡片带勾选和删除，画两次会让用户删错）
    expect(seen.cards.filter((id) => id === "duo")).toHaveLength(1);
    expect(new Set(seen.cards).size).toBe(seen.cards.length);
    expect(seen.unclaimedCards).toEqual(["z9"]);
    expect(seen.unclaimedText).toContain("不参与出片");
    await close();
  }, 180_000);

  it("同屏「生成关键静帧」入口恰好一个，不是三个", async () => {
    const { page, close } = await mount();
    const seen = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button")).filter(
        (b) => (b.textContent || "").replace(/\s+/g, "") === "生成关键静帧",
      );
      return {
        count: buttons.length,
        entries: buttons.map((b) => b.getAttribute("data-manhua-keyart-entry")),
      };
    });
    const count = seen.count;
    // 资产阶段：阶段主操作此刻不是静帧、分镜面板没挂载 → 入口归工具条，恰好一个
    expect(count).toBe(1);
    expect(seen.entries).toEqual(["toolbar"]);
    await close();
  }, 180_000);

  /**
   * 这一条才是真正能抓到「三个按钮」的：分镜阶段工具条与分镜面板两处同时具备条件，
   * 让位逻辑一旦失效，同屏就会出现第二个。变异验证：把工具条的让位判断改成恒真 → 本条转红。
   */
  it("关掉简洁模式的分镜阶段（工具条+面板都具备条件）同屏仍然只有一个入口", async () => {
    const { page, close } = await mountStoryboard();
    const seen = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button")).filter(
        (b) => (b.textContent || "").replace(/\s+/g, "") === "生成关键静帧",
      );
      return {
        count: buttons.length,
        entries: buttons.map((b) => b.getAttribute("data-manhua-keyart-entry")),
        pointerText: /出静帧走底栏主操作/.test(document.body.innerText),
      };
    });
    expect(seen.count).toBe(1);
    expect(seen.entries.filter(Boolean)).toHaveLength(1);
    await close();
  }, 180_000);

  /**
   * 阻断卡集中显示：真实页面上要一次看到「卡着几条」，本步排最前，
   * 提醒项不许被藏掉（藏提示正是线上那个毛病本身），点某一条要把那一条的 id 交回去。
   */
  it("主任务条下面出现阻断卡：本步排最前、报清条数、提醒项照样显示、点一条回传该条 id", async () => {
    const { page, close } = await mount();
    const seen = await page.evaluate(() => {
      const card = document.querySelector("[data-manhua-blocker-card]");
      if (!card) return null;
      return {
        count: card.getAttribute("data-manhua-blocker-count"),
        headline: (card.querySelector("span")?.textContent || "").trim(),
        order: Array.from(card.querySelectorAll("[data-manhua-blocker]")).map((b) => ({
          id: b.getAttribute("data-manhua-blocker"),
          text: (b.textContent || "").replace(/\s+/g, " ").trim(),
        })),
        advisoryCount: card
          .querySelector("[data-manhua-advisory-count]")
          ?.getAttribute("data-manhua-advisory-count"),
        advisoryText: (card.querySelector("[data-manhua-advisory-count]")?.textContent || "")
          .replace(/\s+/g, " ")
          .trim(),
      };
    });
    expect(seen, "阻断卡没有渲染出来").not.toBeNull();
    expect(seen.count).toBe("2");
    expect(seen.headline).toBe("本步卡着 1 条，全片共 2 条要解");
    // 夹具里「后续阶段」那条排在数组第一个：排序失效页面顺序就会反过来（变异验过会红）
    expect(seen.order.map((o) => o.id)).toEqual(["asset-gap", "keyframe"]);
    expect(seen.order[0].text.startsWith("本步")).toBe(true);
    expect(seen.order[1].text.startsWith("本步")).toBe(false);
    expect(seen.advisoryCount).toBe("1");
    expect(seen.advisoryText).toContain("不挡出片");
    const opened = await page.evaluate(() => {
      (document.querySelector('[data-manhua-blocker="keyframe"]') as HTMLButtonElement).click();
      return (window as never as { fixture: { openedIssue?: string | null } }).fixture.openedIssue;
    });
    expect(opened).toBe("keyframe");
    await close();
  }, 180_000);

  /**
   * 三栏分镜的第三栏：当前镜参数从列表卡里搬出来。
   * 原先选中的卡会就地展开 10 个镜位按钮，列表跟着重排；现在列表只管图与状态，
   * 参数归当前镜面板 —— 并且状态文案与列表卡走同一处判断。
   */
  it("分镜阶段：镜位参数不再挤在列表卡里，当前镜面板显示镜号+状态+镜位，点镜位只改本镜", async () => {
    const { page, close } = await mountStoryboard();
    const seen = await page.evaluate(() => {
      const panel = document.querySelector("[data-manhua-shot-params]");
      const cards = Array.from(document.querySelectorAll("[data-manhua-shot]"));
      return {
        hasPanel: Boolean(panel),
        panelShot: panel?.getAttribute("data-manhua-shot-params"),
        panelText: (panel?.textContent || "").replace(/\s+/g, " ").trim(),
        statusZh: panel?.querySelector("[data-manhua-shot-params-status]")?.textContent?.trim() || "",
        anglesInPanel: panel?.querySelectorAll("[data-manhua-shot-angle]").length || 0,
        // 列表卡里不该再有镜位按钮
        anglesInCards: cards.reduce((n, c) => n + c.querySelectorAll("[data-manhua-shot-angle]").length, 0),
        cardCount: cards.length,
        cardStatuses: cards.slice(0, 3).map((c) => c.getAttribute("data-manhua-keyart-status")),
      };
    });
    expect(seen.hasPanel, "当前镜面板没渲染出来").toBe(true);
    expect(seen.cardCount).toBeGreaterThan(1);
    expect(seen.anglesInPanel).toBeGreaterThanOrEqual(8);
    expect(seen.anglesInCards).toBe(0);
    expect(seen.panelText).toContain("当前第");
    // 状态与列表卡同源：这批夹具没有静帧，所以两边都必须是「待出」
    expect(seen.statusZh).toBe("待出分镜图");
    expect(seen.cardStatuses.every((x) => x === "idle")).toBe(true);

    // 点一个镜位：只有被点那个按下，其它不受影响
    const pressed = await page.evaluate(() => {
      const panel = document.querySelector("[data-manhua-shot-params]")!;
      const buttons = Array.from(panel.querySelectorAll("[data-manhua-shot-angle]")) as HTMLButtonElement[];
      const target = buttons.find((b) => b.getAttribute("data-manhua-shot-angle") === "low") || buttons[1]!;
      target.click();
      return Array.from(panel.querySelectorAll("[data-manhua-shot-angle]"))
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.getAttribute("data-manhua-shot-angle"));
    });
    expect(pressed).toHaveLength(1);
    await close();
  }, 180_000);

  /**
   * 二级工具：对象不在本阶段时从主操作簇收进「更多操作」抽屉。
   * 断言的是**恰好一个入口**——既不在两处重复，也不会某阶段无处可去。
   * 资产阶段：3D 归簇；白模／动作节奏／声音归抽屉。
   */
  it("资产阶段：3D 模型留在主操作簇，白模／动作节奏／声音收进更多操作抽屉", async () => {
    const { page, close } = await mount();
    const seen = await page.evaluate(() => {
      const cluster = Array.from(document.querySelectorAll('[data-manhua-tool-home="cluster"]')).map(
        (b) => b.getAttribute("data-manhua-action"),
      );
      // 打开「更多操作」抽屉
      const more = Array.from(document.querySelectorAll("button")).find(
        (b) => b.getAttribute("data-manhua-action") === "open-more-tools",
      ) as HTMLButtonElement | undefined;
      more?.click();
      return { cluster, hasMore: Boolean(more) };
    });
    expect(seen.hasMore).toBe(true);
    // 资产阶段主操作簇里只有 3D，没有段级工具
    expect(seen.cluster).toContain("open-3d-model-studio");
    expect(seen.cluster).not.toContain("open-previs-studio");
    expect(seen.cluster).not.toContain("open-action-timeline");
    expect(seen.cluster).not.toContain("open-audio-studio");

    const drawer = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("[data-manhua-secondary-tool]"));
      return {
        tools: rows.map((b) => b.getAttribute("data-manhua-secondary-tool")),
        homes: rows.map((b) => b.getAttribute("data-manhua-tool-home")),
      };
    });
    expect(drawer.tools).toEqual(["previs", "actionTimeline", "audio"]);
    expect(drawer.homes.every((h) => h === "drawer")).toBe(true);
    // 3D 已经在簇里，抽屉里不许再出现一个
    expect(drawer.tools).not.toContain("model3d");
    await close();
  }, 180_000);

  it("分镜阶段反过来：段级工具回到主操作簇，3D 收进抽屉", async () => {
    const { page, close } = await mountStoryboard();
    const cluster = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-manhua-tool-home="cluster"]')).map((b) =>
        b.getAttribute("data-manhua-action"),
      ),
    );
    expect(cluster).toContain("open-previs-studio");
    expect(cluster).toContain("open-action-timeline");
    expect(cluster).toContain("open-audio-studio");
    expect(cluster).not.toContain("open-3d-model-studio");
    await close();
  }, 180_000);
});
