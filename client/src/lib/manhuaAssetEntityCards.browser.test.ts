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
        globalThis.fixture = { keyart: 0, openedIssue: undefined, updatedClip: undefined };
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
              onGenerateSceneWorld={async () => {}}
              onUpdateClipPrompt={(id,prompt) => { globalThis.fixture.updatedClip={id,prompt}; }}
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
          id: 'clip-e01-g0' + n + '-audio',
          episodeIndex: 1,
          videoModel: 'seedance-2.5',
          prompt: '【第' + n + '段·30s】墨屠第' + n + '段对白与动作。',
        }));
        if (globalThis.directorProbe) blocks.push({...defaultCanvasBlock('text',0,0),id:'beats-e01-probe',episodeIndex:1,outputText:'## 分镜表\\n| 镜号 | 景别/运镜 | 内容 | 台词 | 情绪 | 微表情 | 语气 | 时长秒 |\\n| 1 | 双人中景缓推 | 阿菁握拳后松开 | 娘：慢点 | 隐忍 | 肩背轻颤后恢复 | 轻声 | 5 |\\n| 2 | 近景 | 娘看向阿菁 | 无对白 | 放松 | 眉头舒展 | | 5 |'});
        createRoot(document.getElementById('root')).render(
          <TooltipProvider>
            <ManhuaScriptWorkbench
              blocks={blocks} videoModel='seedance-2.5' topic='墨屠守护阿菁'
              episodeCount={1} focusEpisode={1} onFocusEpisode={() => {}}
              characterIds={[]} propIds={[]} outlineConfirmed={true}
              workflowPhase='storyboard' compactUi={false}
              canvasSelectedBlockId={globalThis.directorProbe ? 'clip-e01-g01-audio' : 'clip-e01-g03-cards'}
              directionCanon={{
                mainCardId: 'main',
                cards: [
                  { id: 'main', labelZh: '信息位置可控', rules: [{ id: 'm1', ruleZh: '手法一', stages: ['story','storyboard'], status: 'formal' }, { id: 'm2', ruleZh: '手法二', stages: ['storyboard'], status: 'formal' }] },
                  { id: 'fight', labelZh: '动作改变关系', rules: [{ id: 'f1', ruleZh: '手法二', stages: ['keyframe'], status: 'formal' }] },
                ],
                authorizedCardIds: ['main', 'fight'],
                sceneOverrides: { action: { cardId: 'fight' } },
              }}
              onSelectDirectionCard={() => {}}
              onSelectDirectionSceneCard={() => {}}
              customAssetRefs={refs} assetCanon={canon}
              onUploadCustomAssets={async () => {}}
              onGenerateKeyartShot={async () => { globalThis.fixture.keyart += 1; }}
              onGenerateAllEpisodeKeyarts={async () => { globalThis.fixture.keyart += 1; }}
              onGenerateAsset3d={async () => {}}
              onGenerateSceneWorld={async () => {}}
              onUpdateClipPrompt={(id,prompt) => { globalThis.fixture.updatedClip={id,prompt}; }}
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

async function mountStoryboard(directorProbe = false): Promise<{ page: Page; close: () => Promise<void> }> {
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
  await page.evaluate((enabled) => { (globalThis as any).directorProbe = enabled; }, directorProbe);
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
  it("版本缩略条定位对应原卡，不改变采用职责或触发生成", async () => {
    const { page, close } = await mount();
    try {
      const before = await page.$eval('[data-manhua-asset-entity="wa_char_aqing"] [data-manhua-asset-entity-current-zh]', e => e.textContent);
      await page.evaluate(() => {
        const original = HTMLElement.prototype.scrollIntoView;
        HTMLElement.prototype.scrollIntoView = function(options) {
          (window as any).__versionTarget = this.dataset.manhuaCustomRefId;
          original.call(this, options);
        };
      });
      await page.click('[title="查看阿菁-编辑，不改变采用版本"]');
      expect(await page.evaluate(() => (window as any).__versionTarget)).toBe("a3");
      expect(await page.$eval('[data-manhua-asset-entity="wa_char_aqing"] [data-manhua-asset-entity-current-zh]', e => e.textContent)).toBe(before);
      expect(await page.evaluate(() => (window as any).fixture.keyart)).toBe(0);
    } finally { await close(); }
  }, 180_000);
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
    if (!seen) throw new Error("阻断卡未挂载");
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
  it("资产阶段：辅助工具统一收进更多操作抽屉", async () => {
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
    expect(seen.cluster).toEqual([]);

    const drawer = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("[data-manhua-secondary-tool]"));
      return {
        tools: rows.map((b) => b.getAttribute("data-manhua-secondary-tool")),
        homes: rows.map((b) => b.getAttribute("data-manhua-tool-home")),
      };
    });
    expect(drawer.tools).toEqual(["model3d", "world3d", "previs", "actionTimeline", "audio"]);
    expect(drawer.homes.every((h) => h === "drawer")).toBe(true);
    await close();
  }, 180_000);

  it("分镜阶段：辅助工具不占主操作簇", async () => {
    const { page, close } = await mountStoryboard();
    const cluster = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-manhua-tool-home="cluster"]')).map((b) =>
        b.getAttribute("data-manhua-action"),
      ),
    );
    expect(cluster).toEqual([]);
    await close();
  }, 180_000);

  /**
   * 对照图 08：产物在也不等于完成。长片是旧料合的时候，阶段条第五格不许显示「已完成」，
   * 并且要说清差在哪。这里用真实 ManhuaScriptWorkbench 挂两次（新鲜 / 旧料）对照。
   */
  it("终审格：长片用旧料时不显示已完成并说清原因；同一批料才算过", async () => {
    const readStage = async (extraProps: string) => {
      const built = await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: "tsx",
          contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { TooltipProvider } from './client/src/components/ui/tooltip';
            import ManhuaScriptWorkbench from './client/src/components/ManhuaScriptWorkbench';
            createRoot(document.getElementById('root')).render(
              <TooltipProvider>
                <ManhuaScriptWorkbench
                  blocks={[]} videoModel='seedance-2.5' topic='墨屠守护阿菁'
                  episodeCount={1} focusEpisode={1} onFocusEpisode={() => {}}
                  characterIds={[]} propIds={[]} outlineConfirmed={true}
                  workflowPhase='edit'
                  finalVideoUrl='https://example.test/final.mp4'
                  ${extraProps}
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
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setRequestInterception(true);
      page.on("request", (req) =>
        req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
      );
      await page.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.setContent("<div id=root></div>");
      await page.evaluate(built.outputFiles[0]!.text);
      await page.waitForSelector('[data-manhua-phase="final"]', { timeout: 30_000 });
      const out = await page.evaluate(() => {
        const cell = document.querySelector('[data-manhua-phase="final"]')!;
        return (cell.textContent || "").replace(/\s+/g, " ").trim();
      });
      await ctx.close().catch(() => {});
      return out;
    };

    const stale = await readStage(
      "finalCutStale={true} finalCutStaleReasonZh='这条长片是 6 段合的，现在是 7 段 —— 需重合成'",
    );
    expect(stale).toContain("需重合成");
    expect(stale).toContain("6 段合的");
    expect(stale).not.toContain("已完成");

    const fresh = await readStage("finalCutStale={false} finalCutStaleReasonZh=''");
    expect(fresh).not.toContain("已完成");
    expect(fresh).toContain("需处理");
    expect(fresh).not.toContain("需重合成");
  }, 180_000);

  /**
   * 对照图 01 第三格 + README「分镜页固定三栏：镜头清单、主预览、当前镜参数」。
   * 断言的是**视觉列序**（CSS order），不是 DOM 顺序 —— 真实页面上用户看到的是左中右。
   */
  it("分镜阶段固定三栏：左镜头清单、中主预览、右当前镜参数；挂载资产退成折叠", async () => {
    const { page, close } = await mountStoryboard();
    const seen = await page.evaluate(() => {
      const pick = (name: string) => document.querySelector(`[data-manhua-column="${name}"]`);
      const orderOf = (el: Element | null) =>
        el ? Number(window.getComputedStyle(el).order || "0") : null;
      const script = pick("script");
      const preview = pick("preview");
      const params = pick("params");
      return {
        hasParamsColumn: Boolean(params),
        hasAssetsColumn: Boolean(pick("assets")),
        order: { script: orderOf(script), preview: orderOf(preview), params: orderOf(params) },
        // 当前镜参数面板现在应该在右栏里，而不是在镜头清单那一栏
        paramsInRight: Boolean(params?.querySelector("[data-manhua-shot-params]")),
        primaryInRight: Boolean(params?.querySelector('[data-manhua-action="generate-current-keyart"]')),
        primaryCount: document.querySelectorAll('[data-manhua-action="generate-current-keyart"]').length,
        paramsInScript: Boolean(script?.querySelector("[data-manhua-shot-params]")),
        collapsedAssets: Boolean(document.querySelector("[data-manhua-storyboard-assets-collapsed]")),
      };
    });
    expect(seen.hasParamsColumn, "右栏没有变成当前镜参数").toBe(true);
    expect(seen.hasAssetsColumn, "分镜阶段不该还有常驻资产栏").toBe(false);
    // 左 1 · 中 2 · 右 3
    expect(seen.order.script).toBe(1);
    expect(seen.order.preview).toBe(2);
    expect(seen.order.params).toBe(3);
    expect(seen.paramsInRight).toBe(true);
    expect(seen.primaryInRight).toBe(true);
    expect(seen.primaryCount).toBe(1);
    expect(seen.paramsInScript).toBe(false);

    // 对照图 01 右栏四个字段：时长 / 景别 / 机位运动 / 画面描述（0/200）
    const fields = await page.evaluate(() => {
      const panel = document.querySelector("[data-manhua-shot-params]")!;
      const rows = Array.from(panel.querySelectorAll("[data-manhua-shot-field]")).map((el) => ({
        label: el.getAttribute("data-manhua-shot-field"),
        value: (el.querySelector("dd")?.textContent || "").trim(),
      }));
      const desc = panel.querySelector("[data-manhua-shot-description]");
      return { rows, descText: (desc?.textContent || "").replace(/\s+/g, " ").trim() };
    });
    expect(fields.rows.map((r) => r.label)).toEqual(["镜头时长", "景别", "机位运动"]);
    // 夹具的镜头带机位文本，真实页面上必须切出景别；切不出来才写「未标注」（合同测试另有覆盖）
    const shotSize = fields.rows.find((r) => r.label === "景别")?.value || "";
    expect(shotSize).not.toBe("");
    expect(["全景", "中景", "近景", "中近景", "特写", "大特写", "远景", "大远景", "未标注"]).toContain(shotSize);
    expect(fields.rows.find((r) => r.label === "镜头时长")?.value).toMatch(/秒|未标注/);
    expect(fields.descText).toContain("画面描述");
    expect(fields.descText).toMatch(/\d+\/200/);
    await close();
  }, 180_000);

  /**
   * 对照图 04（mvs-director-continuity）：分镜页给一张紧凑导演卡 ——
   * 当前有效手法 / 来源范围 / 覆盖理由 / 影响预览 / 连续性提醒；
   * 顶栏那五个「场次副卡」下拉在分镜阶段收起（它回答不了「这一段用哪张」）。
   */
  it("分镜阶段：右栏出现紧凑导演卡，顶栏五个场次副卡下拉收起", async () => {
    const { page, close } = await mountStoryboard();
    const seen = await page.evaluate(() => {
      const card = document.querySelector("[data-manhua-director-card]");
      const params = document.querySelector('[data-manhua-column="params"]');
      return {
        hasCard: Boolean(card),
        inRightColumn: Boolean(params?.querySelector("[data-manhua-director-card]")),
        source: card?.getAttribute("data-manhua-director-card-source") || "",
        text: (card?.textContent || "").replace(/\s+/g, " ").trim(),
        sceneCardsInTopBar: Boolean(document.querySelector("[data-manhua-direction-scene-cards]")),
        // 主卡下拉仍然在（导演包本身没被藏掉）
        mainCardSelect: Boolean(document.querySelector("[data-manhua-direction-canon]")),
      };
    });
    expect(seen.hasCard, "导演卡没渲染").toBe(true);
    expect(seen.inRightColumn, "导演卡不在右栏").toBe(true);
    expect(seen.sceneCardsInTopBar, "顶栏五个场次副卡下拉应在分镜阶段收起").toBe(false);
    expect(seen.mainCardSelect, "导演包主卡入口不该被一起藏掉").toBe(true);
    expect(seen.text).toContain("投影到");
    await close();
  }, 180_000);

  /**
   * 对照图 02 第三格：对白与配乐面板开头要能一眼看到「这一段有什么」。
   * 对照图 04 的硬要求：混合轨不许伪装成多轨。
   * 这里直接挂真实的 `CanvasAudioStudioView`（离线视图，不接付费服务）。
   */
  it("对白与配乐面板顶部：当前片段摘要按真实 cue 统计，只有预混母轨时不谎称多轨", async () => {
    const mountAudio = async (extra: string) => {
      const built = await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: "tsx",
          contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { CanvasAudioStudioView } from './client/src/components/canvas/CanvasAudioStudio';
            import { defaultCanvasBlock } from './client/src/lib/canvasTypes';
            import { emptyCanvasAudioStudio, createCanvasAudioCue, canvasAudioCueInputKey } from './shared/canvasAudioStudio';
            const cue = (kind, id, speakerZh, selectedTakeId) => {
              const value = { ...createCanvasAudioCue(kind, id), speakerZh, textZh: '别怕，站我身后。', approved: Boolean(selectedTakeId) };
              return selectedTakeId ? { ...value, selectedTakeId, takes: [{ id: selectedTakeId, gcsUri: 'gs://b/a.wav', previewUrl: '', durationSec: 2, createdAt: '2026-09-19', inputKey: canvasAudioCueInputKey(value) }] } : value;
            };
            const block = {
              ...defaultCanvasBlock('video', 0, 0),
              id: 'clip-e01-g01-audio', episodeIndex: 1, videoModel: 'seedance-2.5',
              prompt: '【第1段·30s】墨屠第1段对白与动作。',
              ${extra}
            };
            const services = {
              resolveAudio: async () => '', generateDialogue: async () => { throw Error('本测试禁止生成'); },
              getDialogue: async () => ({}), draftMusic: async () => { throw Error('本测试禁止生成'); },
              generateMusic: async () => { throw Error('本测试禁止生成'); }, getMusic: async () => ({}),
              listMusic: async () => [], queuePost: async () => { throw Error('本测试禁止生成'); }, getPost: async () => ({}),
            };
            globalThis.mkCue = cue;
            createRoot(document.getElementById('root')).render(
              <CanvasAudioStudioView block={block} onChange={() => {}} services={services} />,
            );
          `,
        },
        bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
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
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setRequestInterception(true);
      page.on("request", (req) =>
        req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
      );
      await page.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.setContent("<div id=root></div>");
      await page.evaluate(built.outputFiles[0]!.text);
      await page.waitForSelector("[data-manhua-sound-summary]", { timeout: 30_000 });
      const out = await page.evaluate(() => {
        const box = document.querySelector("[data-manhua-sound-summary]")!;
        return {
          multitrack: box.getAttribute("data-manhua-sound-multitrack"),
          text: (box.textContent || "").replace(/\s+/g, " ").trim(),
        };
      });
      await ctx.close().catch(() => {});
      return out;
    };

    // 空态：如实说没有声音任务，绝不显示成多轨
    const empty = await mountAudio("");
    expect(empty.text).toContain("第1段");
    expect(empty.text).toContain("角色配音 0");
    expect(empty.text).toContain("还没有任何声音任务");
    expect(empty.multitrack).toBe("0");

    // 只有预混母轨：明说不是多轨
    const premix = await mountAudio(
      "seedance25RefAudioUrls: ['https://example.test/premix.wav'], audioStudio: { ...emptyCanvasAudioStudio(), cues: [cue('dialogue','line-1','阿菁')] },",
    );
    expect(premix.multitrack).toBe("0");
    expect(premix.text).toContain("不是多轨");

    // 对白与配乐均有当前输入对应的已采用产物，才算多轨
    const real = await mountAudio(
      "audioStudio: { ...emptyCanvasAudioStudio(), cues: [cue('dialogue','line-1','阿菁','take-1'), cue('dialogue','line-2','掌柜','take-2'), cue('bgm','music-1','','music-take-1')], musicJobIds: [] },",
    );
    expect(real.multitrack).toBe("1");
    expect(real.text).toContain("角色配音 2");
    expect(real.text).toContain("背景音乐 1");
    expect(real.text).toContain("各自成轨");
  }, 180_000);

  /**
   * 对照图 02 + README：「沿用本集画布和段身份，**侧栏显示所选镜头**」。
   * 夹具故意让画布选中第 3 段的节点、而当前段是第 1 段 ——
   * 侧栏必须说清「这不是当前段」并给一键切过去，否则用户会对着别段的参数改半天。
   */
  it("侧栏显示画布所选节点身份；选中别段时明说并可一键切段", async () => {
    const { page, close } = await mountStoryboard();
    const seen = await page.evaluate(() => {
      const params = document.querySelector('[data-manhua-column="params"]');
      const sel = document.querySelector("[data-manhua-canvas-selection]");
      return {
        inRightColumn: Boolean(params?.querySelector("[data-manhua-canvas-selection]")),
        belongs: sel?.getAttribute("data-manhua-canvas-selection-belongs") || "",
        text: (sel?.textContent || "").replace(/\s+/g, " ").trim(),
        jumpTo: document
          .querySelector("[data-manhua-canvas-selection-jump]")
          ?.getAttribute("data-manhua-canvas-selection-jump"),
      };
    });
    expect(seen.inRightColumn, "画布选中身份没出现在右栏").toBe(true);
    expect(seen.text).toContain("画布选中");
    expect(seen.text).toContain("第3段");
    expect(seen.belongs).toBe("other");
    expect(seen.text).toContain("不属于当前");
    expect(seen.jumpTo).toBe("3");
    await close();
  }, 180_000);

  /**
   * 对照图 03：终审页要的是一张清单（每项通过/不通过）+「存在 N 处需处理的问题，才能通过终审」。
   * 这里验的核心是**没证据的项写「未检」不写「通过」** —— 空项目里五项应该全是未检或不通过。
   */
  it("终审阶段：检查清单逐项给状态，没证据的写未检而不是通过", async () => {
    const built = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { TooltipProvider } from './client/src/components/ui/tooltip';
          import ManhuaScriptWorkbench from './client/src/components/ManhuaScriptWorkbench';
          createRoot(document.getElementById('root')).render(
            <TooltipProvider>
              <ManhuaScriptWorkbench
                blocks={[]} videoModel='seedance-2.5' topic='墨屠守护阿菁'
                episodeCount={1} focusEpisode={1} onFocusEpisode={() => {}}
                characterIds={[]} propIds={[]} outlineConfirmed={true}
                workflowPhase='final'
              />
            </TooltipProvider>,
          );
        `,
      },
      bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
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
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) =>
      req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
    );
    await page.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.setContent("<div id=root></div>");
    await page.evaluate(built.outputFiles[0]!.text);
    await page.waitForSelector("[data-manhua-final-checklist]", { timeout: 30_000 });
    const seen = await page.evaluate(() => {
      const box = document.querySelector("[data-manhua-final-checklist]")!;
      return {
        ready: box.getAttribute("data-manhua-final-ready"),
        summary: box.querySelector("[data-manhua-final-summary]")?.textContent?.trim() || "",
        items: Array.from(box.querySelectorAll("[data-manhua-final-check]")).map((el) => ({
          id: el.getAttribute("data-manhua-final-check"),
          state: el.getAttribute("data-manhua-final-check-state"),
        })),
      };
    });
    expect(seen.items.map((i) => i.id)).toEqual(["content", "picture", "audio", "subtitle", "cut_fresh"]);
    // 空项目：一项都不该是「通过」
    expect(seen.items.some((i) => i.state === "pass")).toBe(false);
    expect(seen.ready).toBe("0");
    expect(seen.summary).toContain("未检");
    await ctx.close().catch(() => {});
  }, 180_000);
});

it("导演执行表与分类特效在真实工作台显示，采用只写当前段而不生成", async () => {
  const {page,close}=await mountStoryboard(true);
  try {
    await page.waitForSelector("[data-manhua-director-execution]");
    await page.click("[data-manhua-director-execution] summary");
    expect(await page.$eval("[data-manhua-director-execution]",el=>el.textContent)).toContain("情绪与细微表演");
    await page.click("[data-manhua-vfx-picker] summary");
    await page.waitForSelector("[data-manhua-vfx-picker] button");
    await page.click("[data-manhua-vfx-picker] button");
    const description=await page.$eval('[aria-label="本镜特效描述"]',el=>(el as HTMLTextAreaElement).value);
    expect(description.length).toBeGreaterThan(50);
    const applied=await page.evaluate(()=>{
      const button=Array.from(document.querySelectorAll<HTMLButtonElement>("[data-manhua-vfx-picker] button")).find(b=>b.textContent?.includes("采用到当前镜头"))!;
      const enabled=!button.disabled; if(enabled) button.click(); return enabled;
    });
    expect(applied).toBe(true);
    const result=await page.evaluate(()=>(globalThis as any).fixture);
    expect(result.updatedClip.id).toMatch(/^clip-e01/);
    expect(result.updatedClip.prompt).toContain("【用户补充】");
    expect(result.updatedClip.prompt).toContain("【镜头特效：");
    expect(result.updatedClip.prompt).toContain(description);
    expect(result.keyart).toBe(0);
  } finally {await close();}
},180_000);
