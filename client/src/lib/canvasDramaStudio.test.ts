import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MANHUA_FACTORY_STAGE_ORDER,
  MANHUA_KEYART_PARALLEL_CONCURRENCY,
  applyFactoryPrefsToBlocks,
  applyTopicToFactoryStory,
  ensureManhuaFragmentClips,
  expandManhuaShotKeyartsAfterReverse,
  extractFactoryMotionHints,
  filterBlocksByEpisode,
  getBlockEpisodeIndex,
  filterManhuaFactoryTargetIds,
  isTransientFactoryError,
  layoutManhuaEpisodeReadableChain,
  manhuaEpisodeHasFactoryChain,
  replaceManhuaEpisodeChain,
  stripManhuaFactoryCanvasArtifacts,
  resolveFactoryResumeStage,
  resolveManhuaEpisodeSpawnContinuity,
  resolveManhuaFactoryOrderedIds,
  resolveManhuaFragmentRunTargets,
  runManhuaDramaFactoryPipeline,
  sanitizeManhuaRecapUpstreamLinks,
  spawnManhuaDramaStudio,
  spawnManhuaDramaStudioSeries,
} from "./canvasDramaStudio";
import { collectVisionImages, resolveNearestUpstreamImageUrl } from "./canvasTypes";
import * as canvasRunBlock from "./canvasRunBlock";
import type { CanvasRunDeps } from "./canvasRunBlock";
import { resolveKeyartShotIndex } from "@shared/manhuaScriptWorkbench";

describe("canvasDramaStudio factory", () => {
  it("does not hard-apply dynasty wardrobe from topic text", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "唐朝贵女宫廷复仇",
      episodeIndex: 1,
    });
    const bible = blocks.find((b) => b.id.startsWith("bible-"));
    const keyart = blocks.find((b) => b.id.startsWith("keyart-"));
    expect(bible?.prompt || "").not.toContain("朝代服饰锚点");
    expect(keyart?.prompt || "").not.toContain("朝代服饰锚点");
  });

  it("injects dynasty wardrobe only when ids are explicit", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "玄幻修仙门派",
      episodeIndex: 1,
      dynastyWardrobeIds: ["dyn_tang"],
    });
    const bible = blocks.find((b) => b.id.startsWith("bible-"));
    expect(bible?.prompt || "").toContain("朝代服饰锚点");
    expect(bible?.prompt || "").toContain("齐胸襦裙");
  });

  it("spawns six linked stages with topic (成片仅 Seedance，不再铺改写节点)", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "星际车站离别",
    });
    expect(blocks).toHaveLength(6);
    expect(edges).toHaveLength(5);
    for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
      if (stage === "recap_card" || stage === "omni_edit") continue;
      expect(blocks.some((b) => b.id.startsWith(`${stage}-`))).toBe(true);
    }
    expect(blocks.some((b) => b.id.startsWith("omni_edit-"))).toBe(false);
    expect(blocks[0]!.prompt).toContain("星际车站离别");
    const clip = blocks.find((b) => b.id.startsWith("clip-"))!;
    expect(clip.videoModel).toBe("seedance-2.0-fast");
  });

  it("spawns with genre+scene injects scene asset into key art", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "外门弟子闯秘境",
      genreId: "xianxia",
      sceneId: "scene_04",
    });
    const key = blocks.find((b) => b.id.startsWith("keyart-"))!;
    // 源头短包：场景只留短锁名，不灌场景全文（如发光晶石）
    expect(key.prompt).toContain("【静帧·源头短包】");
    expect(key.prompt).toContain("秘境洞府");
    expect(key.prompt).not.toContain("发光晶石");
    expect(blocks[0]!.prompt).toContain("仙侠");
  });

  it("injects character library anchors into bible", () => {
    const { blocks, characterIds } = spawnManhuaDramaStudio({
      topic: "都市律师对峙",
      characterIds: ["char_f_07", "char_m_02"],
    });
    expect(characterIds).toEqual(["char_f_07", "char_m_02"]);
    const bible = blocks.find((b) => b.id.startsWith("bible-"))!;
    expect(bible.prompt).toContain("唐若曦");
    expect(bible.prompt).toContain("傅临渊");
    expect(bible.prompt).toContain("【角色库锚点】");
  });

  it("injects motion prompt craft into clip", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "产品拆解种草",
      motionPromptIds: ["product_05_exploded_view"],
    });
    const clip = blocks.find((b) => b.id.startsWith("clip-"))!;
    expect(clip.prompt).toContain("爆炸拆解");
    expect(clip.prompt).toContain("【包装动效手法】");
  });

  it("injects craft shot bank into beats / reverse / keyart", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "权谋对峙",
      craftShotIds: ["light_03_high_contrast", "cam_01_slow_push"],
      videoReverseOutputMode: "compact",
    });
    const beats = blocks.find((b) => b.id.startsWith("beats-"))!;
    const reverse = blocks.find((b) => b.id.startsWith("reverse-"))!;
    const keyart = blocks.find((b) => b.id.startsWith("keyart-"))!;
    expect(beats.prompt).toContain("【手法条目库·原子镜头】");
    expect(reverse.prompt).toContain("高反差");
    // 手法库进节拍/反推；静帧源头短包不再堆手法长文
    expect(keyart.prompt).toContain("【静帧·源头短包】");
    expect(keyart.prompt).not.toContain("【手法条目库·原子镜头】");
    expect(reverse.videoReverseOutputMode).toBe("compact");
    expect(beats.prompt).not.toMatch(/Nolan|王家卫/i);
  });

  it("auto-injects craft shot from topic when craftShotIds omitted", () => {
    const { blocks } = spawnManhuaDramaStudio({ topic: "宫斗权谋翻盘" });
    const beats = blocks.find((b) => b.id.startsWith("beats-"))!;
    expect(beats.prompt).toContain("【手法条目库·原子镜头】");
    expect(beats.prompt).toContain("高反差");
  });

  it("auto-injects path + action camera for fight topic when ids omitted", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "江湖刀光打斗交锋",
      writerContext: "雨夜客栈拔刀交锋，比武闪避",
    });
    const clip = blocks.find((b) => b.id.startsWith("clip-"))!;
    const beats = blocks.find((b) => b.id.startsWith("beats-"))!;
    expect(clip.prompt).toContain("【路径运镜配方】");
    expect(clip.prompt).toContain("【动作运镜配方】");
    expect(beats.prompt).toMatch(/打斗|动作运镜|路径运镜/);
  });

  it("auto-injects path + action for multi-person body motion / match topic", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "校园球赛决赛",
      writerContext: "多人同框冲刺与肢体移位，观众围观",
    });
    const clip = blocks.find((b) => b.id.startsWith("clip-"))!;
    expect(clip.prompt).toContain("【路径运镜配方】");
    expect(clip.prompt).toContain("【动作运镜配方】");
  });

  it("expanded multi-shot keyarts keep scene and character inject", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "江湖刀客雨夜客栈",
      episodeIndex: 1,
      sceneId: "scene_07",
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
    });
    const reverse = blocks.find((b) => b.id.startsWith("reverse-"))!;
    const withReverse = blocks.map((b) =>
      b.id === reverse.id
        ? {
            ...b,
            status: "done" as const,
            outputText: "1. 推门\n2. 对峙\n3. 拔刀\n4. 收刀",
          }
        : b,
    );
    const expanded = expandManhuaShotKeyartsAfterReverse(withReverse, edges, reverse.id);
    const keyarts = expanded.blocks.filter((b) => b.id.startsWith("keyart-"));
    expect(keyarts.length).toBe(4);
    for (const k of keyarts) {
      expect(k.prompt).toMatch(/场景|角色|原型|画风/);
    }
  });

  it("applyFactoryPrefsToBlocks updates reverse mode and craft inject", () => {
    const { blocks } = spawnManhuaDramaStudio({ topic: "都市恋爱" });
    const next = applyFactoryPrefsToBlocks(blocks, {
      craftShotIds: ["cam_06_intimate_cu"],
      videoReverseOutputMode: "en",
      motionPromptIds: [],
    });
    const reverse = next.find((b) => b.id.startsWith("reverse-"))!;
    expect(reverse.videoReverseOutputMode).toBe("en");
    expect(reverse.prompt).toContain("贴身近景");
  });

  it("spawn and applyFactoryPrefs inject selected prop anchors", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "商战并购",
      propIds: ["demo_prop_business_fountain_pen"],
    });
    expect(blocks.find((b) => b.id.startsWith("bible-"))!.prompt).toContain("【点选道具锚点】");
    expect(blocks.find((b) => b.id.startsWith("bible-"))!.prompt).toContain("签约钢笔");
    expect(blocks.find((b) => b.id.startsWith("keyart-"))!.prompt).toContain("【道具短锁】");
    expect(blocks.find((b) => b.id.startsWith("keyart-"))!.prompt).toContain("签约钢笔");
    const next = applyFactoryPrefsToBlocks(blocks, {
      propIds: ["demo_prop_romance_ring_box"],
      craftShotIds: [],
      motionPromptIds: [],
    });
    const bible = next.find((b) => b.id.startsWith("bible-"))!.prompt;
    expect(bible).toContain("戒指盒");
    expect(bible).not.toContain("签约钢笔");
  });

  it("factory text stages default to gpt-5.6-sol", () => {
    const { blocks } = spawnManhuaDramaStudio({ topic: "仙侠逆袭" });
    for (const prefix of ["story-", "bible-", "beats-"] as const) {
      expect(blocks.find((b) => b.id.startsWith(prefix))!.textModel).toBe("gpt-5.6-sol");
    }
  });

  it("applyFactoryPrefsToBlocks syncs scene into story/keyart", () => {
    const { blocks } = spawnManhuaDramaStudio({
      genreId: "xianxia",
      sceneId: "scene_01",
      topic: "外门弟子",
    });
    expect(blocks.find((b) => b.id.startsWith("story-"))!.prompt).toContain("仙侠宗门");
    const next = applyFactoryPrefsToBlocks(blocks, {
      sceneId: "scene_04",
      craftShotIds: [],
      motionPromptIds: [],
    });
    const story = next.find((b) => b.id.startsWith("story-"))!.prompt;
    const key = next.find((b) => b.id.startsWith("keyart-"))!.prompt;
    expect(story).toContain("秘境洞府");
    expect(story).not.toContain("仙侠宗门场景");
    expect(key).toContain("秘境洞府");
    expect(key).toContain("【场景短锁】");
    expect(key).not.toContain("本集主场景优先");
  });

  it("applyFactoryPrefsToBlocks syncs genre template on story/bible", () => {
    const { blocks } = spawnManhuaDramaStudio({
      genreId: "xianxia",
      topic: "外门弟子",
    });
    expect(blocks.find((b) => b.id.startsWith("story-"))!.prompt).toContain("仙侠");
    const next = applyFactoryPrefsToBlocks(blocks, {
      genreId: "urban",
      sceneId: "scene_12",
      craftShotIds: [],
      motionPromptIds: [],
    });
    const story = next.find((b) => b.id.startsWith("story-"))!.prompt;
    expect(story).toContain("都市");
    expect(story).toContain("都市办公室");
    expect(story).not.toMatch(/编剧剧种模板·仙侠/);
  });

  it("applyFactoryPrefsToBlocks syncs character anchors on bible", () => {
    const { blocks } = spawnManhuaDramaStudio({ topic: "都市恋爱" });
    const next = applyFactoryPrefsToBlocks(blocks, {
      characterIds: ["char_f_01", "char_m_01"],
      artStyleId: "photoreal",
      craftShotIds: [],
      motionPromptIds: [],
    });
    const bible = next.find((b) => b.id.startsWith("bible-"))!.prompt;
    expect(bible).toContain("【角色库锚点】");
    expect(bible).toContain("【画风】");
    expect(bible).toContain("仿真人");
    expect(bible).toMatch(/char_f_01|女主|短发|长发|角色/);
    const keyart = next.find((b) => b.id.startsWith("keyart-"))!.prompt;
    expect(keyart).toContain("【画风硬锁】");
    expect(keyart).toContain("仿真人");
    expect(keyart).toContain("【身份短锁】");
    expect(keyart).not.toContain("【角色库锚点】");
  });

  it("spawns keyart in edit mode with scene/prop fusion refs when demos ready (仿真人)", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "江湖刀客雨夜客栈",
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      sceneId: "scene_07",
      propIds: ["demo_prop_xianxia_sword", "demo_prop_ancient_jade"],
      artStyleId: "photoreal",
    });
    const key = blocks.find((b) => b.id.startsWith("keyart-"))!;
    expect(key.imageMode).toBe("edit");
    expect(key.refImageUrl).toMatch(/\/manhua-scenes\//);
    expect(key.editFusionUrls?.some((u) => u.includes("/manhua-props/"))).toBe(true);
    expect(key.prompt).toMatch(/示范图融图|垫图·改图|融图参考/);
  });

  it("CG 漫剧 keyart uses generate path so photoreal demos cannot lock the still", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "江湖刀客雨夜客栈",
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      sceneId: "scene_07",
      propIds: ["demo_prop_xianxia_sword"],
      artStyleId: "cg_drama",
    });
    const key = blocks.find((b) => b.id.startsWith("keyart-"))!;
    // CG 仍可走垫图改绘；源头短包钉画风硬锁，禁止仿真人漂移
    expect(key.prompt).toContain("【画风硬锁】");
    expect(key.prompt).toContain("CG 漫剧");
    expect(key.prompt).toMatch(/【画风执行·CG/);
  });

  it("expands multi-shot keyarts after reverse and orders all of them", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "江湖刀客雨夜客栈",
      episodeIndex: 1,
    });
    const reverse = blocks.find((b) => b.id.startsWith("reverse-"))!;
    const withReverse = blocks.map((b) =>
      b.id === reverse.id
        ? {
            ...b,
            status: "done" as const,
            outputText: [
              "1. 刀客推门进客栈",
              "2. 对峙油灯",
              "3. 拔刀交锋",
              "4. 雨夜收刀",
            ].join("\n"),
          }
        : b,
    );
    const expanded = expandManhuaShotKeyartsAfterReverse(withReverse, edges, reverse.id);
    const keyarts = expanded.blocks.filter((b) => b.id.startsWith("keyart-"));
    expect(keyarts.length).toBe(4);
    expect(keyarts.every((k) => k.prompt.includes("【分镜"))).toBe(true);
    expect(keyarts.some((k) => k.prompt.includes("拔刀交锋"))).toBe(true);
    const ordered = resolveManhuaFactoryOrderedIds(expanded.blocks, "keyart", 1);
    expect(ordered.filter((id) => id.startsWith("keyart-"))).toHaveLength(4);
    // 4 镜 ÷ 每段 3 镜 → 2 段 → 2 条成片（另可能保留工厂主 clip）
    const clips = expanded.blocks.filter(
      (b) => b.id.startsWith("clip-") && (/-g\d{2}/i.test(b.id) || /-s\d{2}/.test(b.id)),
    );
    expect(clips.length).toBeGreaterThanOrEqual(1);
    expect(clips.every((c) => keyarts.some((k) => k.id === c.parentId))).toBe(true);
    expect(clips[0]!.videoModel).toBe("seedance-2.0-fast");
    const orderedClip = resolveManhuaFactoryOrderedIds(expanded.blocks, "clip", 1);
    expect(orderedClip.filter((id) => id.startsWith("clip-")).length).toBeGreaterThanOrEqual(1);
    const frag1 = resolveManhuaFragmentRunTargets(expanded.blocks, 1, 1);
    expect(frag1.clipId).toMatch(/-g01|-s01/);
    expect(frag1.keyartId).toMatch(/keyart-/);
    expect(frag1.forceFromStage).toBe("keyart");
    expect(frag1.targetBlockIds.length).toBeGreaterThanOrEqual(2);
    expect(filterManhuaFactoryTargetIds(orderedClip, frag1.targetBlockIds)).toEqual(
      frag1.targetBlockIds.filter((id) => orderedClip.includes(id)),
    );
    // 成片 parent 必须是段内某张静帧
    expect(clips[0]!.parentId).toMatch(/^keyart-/);
    expect(keyarts.some((k) => k.id === clips[0]!.parentId)).toBe(true);
  });

  it("resolveManhuaFragmentRunTargets refuses clip-only when keyart missing", () => {
    const { blocks } = spawnManhuaDramaStudio({ topic: "江湖刀客", episodeIndex: 1 });
    const onlyClip = resolveManhuaFragmentRunTargets(
      blocks.filter((b) => !b.id.startsWith("keyart-")),
      1,
      2,
    );
    expect(onlyClip.targetBlockIds).toEqual([]);
  });

  it("layoutManhuaEpisodeReadableChain stacks keyarts in columns of 5 and stamps @ tags", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "江湖刀客雨夜客栈",
      episodeIndex: 1,
    });
    const reverse = blocks.find((b) => b.id.startsWith("reverse-"))!;
    const shotLines = Array.from({ length: 13 }, (_, i) => `${i + 1}. 节拍动作${i + 1}`).join(
      "\n",
    );
    const withAssets = blocks.map((b) =>
      b.id === reverse.id
        ? { ...b, status: "done" as const, outputText: shotLines }
        : b,
    );
    const withSheets = [
      ...withAssets,
      {
        ...withAssets[0]!,
        id: "charsheet-hero",
        kind: "image" as const,
        x: 0,
        y: 0,
        prompt: "角色",
        episodeIndex: 1,
      },
      {
        ...withAssets[0]!,
        id: "sceneplate-inn",
        kind: "image" as const,
        x: 0,
        y: 0,
        prompt: "场景",
        episodeIndex: 1,
      },
    ];
    const expanded = expandManhuaShotKeyartsAfterReverse(withSheets, edges, reverse.id);
    const laid = layoutManhuaEpisodeReadableChain(expanded.blocks, 1);
    const assets = laid
      .filter((b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"))
      .sort((a, b) => a.x - b.x);
    const keyarts = laid
      .filter((b) => b.id.startsWith("keyart-"))
      .sort(
        (a, b) =>
          resolveKeyartShotIndex(a.id, a.prompt) - resolveKeyartShotIndex(b.id, b.prompt),
      );
    expect(assets.length).toBeGreaterThanOrEqual(2);
    expect(assets[0]!.prompt).toMatch(/【画布资产@】@角色/);
    expect(assets.find((b) => b.id.startsWith("sceneplate-"))!.prompt).toMatch(
      /【画布资产@】@场景/,
    );
    // 角色墙与场景墙分行：场景 y 必须低于角色（不再混在同一横排）
    const hero = laid.find((b) => b.id === "charsheet-hero")!;
    const inn = laid.find((b) => b.id === "sceneplate-inn")!;
    expect(inn.y).toBeGreaterThan(hero.y);
    expect(keyarts.length).toBeGreaterThanOrEqual(6);
    // 同列竖排：前 5 镜同 x、y 递增；第 6 镜换列
    expect(keyarts[1]!.y).toBeGreaterThan(keyarts[0]!.y);
    expect(keyarts[1]!.x).toBe(keyarts[0]!.x);
    expect(keyarts[5]!.x).toBeGreaterThan(keyarts[0]!.x);
    expect(keyarts[0]!.y).toBeGreaterThan(assets[0]!.y);
  });

  it("ensureManhuaFragmentClips lays one clip per segment and targets a single fragment", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "江湖刀客雨夜客栈",
      episodeIndex: 1,
    });
    const reverse = blocks.find((b) => b.id.startsWith("reverse-"))!;
    // 5 镜 → 2 段（每段约 4 静帧）
    const withReverse = blocks.map((b) =>
      b.id === reverse.id
        ? {
            ...b,
            status: "done" as const,
            outputText:
              "1. 刀客推门进客栈\n2. 油灯下对峙\n3. 拔刀交锋\n4. 雨夜收刀\n5. 撑伞离去留钩子",
          }
        : b.id.startsWith("keyart-")
          ? { ...b, status: "done" as const, outputUrl: "https://example.com/k1.jpg" }
          : b,
    );
    const expanded = expandManhuaShotKeyartsAfterReverse(withReverse, edges, reverse.id);
    const withKeyarts = expanded.blocks.map((b) =>
      b.id.startsWith("keyart-")
        ? { ...b, status: "done" as const, outputUrl: `https://example.com/${b.id}.jpg` }
        : b,
    );
    const ensured = ensureManhuaFragmentClips(withKeyarts, expanded.edges, 1);
    const segClips = ensured.blocks.filter(
      (b) => b.id.startsWith("clip-") && (/-g\d{2,}/i.test(b.id) || /-s\d{2,}/.test(b.id)),
    );
    expect(segClips.length).toBe(2);
    const frag = resolveManhuaFragmentRunTargets(ensured.blocks, 1, 2);
    expect(frag.clipId).toBeTruthy();
    expect(frag.forceFromStage).toBe("clip");
    expect(frag.targetBlockIds).toEqual([frag.clipId]);
    const ordered = resolveManhuaFactoryOrderedIds(ensured.blocks, "clip", 1);
    expect(filterManhuaFactoryTargetIds(ordered, frag.targetBlockIds)).toEqual([frag.clipId]);
  });

  it("episode 2 first segment clip uses global g13", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "续集客栈余波",
      episodeIndex: 2,
    });
    const reverse = blocks.find((b) => b.id.startsWith("reverse-"))!;
    const withReverse = blocks.map((b) =>
      b.id === reverse.id
        ? {
            ...b,
            status: "done" as const,
            outputText: "1. 推门\n2. 对峙\n3. 拔刀\n4. 收刀",
          }
        : b,
    );
    const expanded = expandManhuaShotKeyartsAfterReverse(withReverse, edges, reverse.id);
    const withKeyarts = expanded.blocks.map((b) =>
      b.id.startsWith("keyart-")
        ? { ...b, status: "done" as const, outputUrl: `https://example.com/${b.id}.jpg` }
        : b,
    );
    const ensured = ensureManhuaFragmentClips(withKeyarts, expanded.edges, 2);
    const clips = ensured.blocks.filter((b) => b.id.startsWith("clip-") && /-g\d{2,}/i.test(b.id));
    expect(clips.some((c) => /-g13(?:-|$)/i.test(c.id))).toBe(true);
    expect(clips[0]?.prompt || "").toMatch(/镜头连续性|跨段转场/);
  });

  it("removes stale keyarts when a rerun returns fewer shots", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "江湖刀客雨夜客栈",
      episodeIndex: 1,
    });
    const reverse = blocks.find((b) => b.id.startsWith("reverse-"))!;
    const fourShotBlocks = blocks.map((b) =>
      b.id === reverse.id
        ? { ...b, status: "done" as const, outputText: "1. 推门\n2. 对峙\n3. 拔刀\n4. 收刀" }
        : b,
    );
    const expanded = expandManhuaShotKeyartsAfterReverse(fourShotBlocks, edges, reverse.id);
    const threeShotBlocks = expanded.blocks.map((b) =>
      b.id === reverse.id ? { ...b, outputText: "1. 推门\n2. 对峙\n3. 收刀" } : b,
    );
    const shrunk = expandManhuaShotKeyartsAfterReverse(
      threeShotBlocks,
      expanded.edges,
      reverse.id,
    );
    const keyarts = shrunk.blocks.filter((b) => b.id.startsWith("keyart-"));
    expect(keyarts).toHaveLength(3);
    expect(keyarts.some((b) => b.id.includes("-s04-"))).toBe(false);
    expect(shrunk.edges.some((edge) => edge.fromId.includes("-s04-") || edge.toId.includes("-s04-"))).toBe(false);
  });

  it("spawn/prefs inject wardrobe+cast+genre into keyart (not bible-only)", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "仙侠剑修闯秘境",
      genreId: "xianxia",
      sceneId: "scene_04",
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      wardrobePropContinuityIds: ["wpc_01_xianxia_sword"],
      propIds: ["demo_prop_xianxia_sword"],
      writerContext: "【编剧视觉摘要】女帝青衣佩剑，雨夜秘境石阶，冷青雾气。",
    });
    const key = blocks.find((b) => b.id.startsWith("keyart-"))!.prompt;
    // 源头短包：静帧只留短锁；服装连续/剧种/视觉简报长文留在 bible/beats
    expect(key).toContain("【静帧·源头短包】");
    expect(key).toContain("【身份短锁】");
    expect(key).toContain("【场景短锁】");
    expect(key).toContain("【道具短锁】");
    expect(key).toMatch(/秘境|洞府/);
    expect(key).not.toContain("【服装道具连续性】");
    expect(key).not.toContain("【编剧剧种模板");
    expect(key).not.toContain("## 人物表");
    const next = applyFactoryPrefsToBlocks(blocks, {
      wardrobePropContinuityIds: ["wpc_03_urban_power"],
      characterIds: ["char_f_02", "char_m_02"],
      ancientArchetypeIds: [],
      genreId: "urban",
      sceneId: "scene_12",
      craftShotIds: [],
      motionPromptIds: [],
    });
    const key2 = next.find((b) => b.id.startsWith("keyart-"))!.prompt;
    expect(key2).toContain("【静帧·源头短包】");
    expect(key2).toContain("【身份短锁】");
    expect(key2).toContain("都市办公室");
    expect(key2).not.toContain("【角色库锚点】");
  });

  it("spawn/prefs wire custom https refs into keyart edit fusion", () => {
    const customRefs = [
      {
        id: "cust_c",
        url: "https://cdn.example/char.jpg",
        role: "character" as const,
        labelZh: "自传人物",
      },
      {
        id: "cust_s",
        url: "https://cdn.example/scene.jpg",
        role: "scene" as const,
        labelZh: "自传场景",
      },
    ];
    const { blocks } = spawnManhuaDramaStudio({
      topic: "自传融图",
      characterIds: ["char_f_01"],
      sceneId: "scene_12",
      artStyleId: "photoreal",
      customRefs,
    });
    const key = blocks.find((b) => b.id.startsWith("keyart-"))!;
    expect(key.imageMode).toBe("edit");
    expect(key.refImageUrl).toMatch(/^https:\/\//);
    expect([key.refImageUrl, ...(key.editFusionUrls || [])]).toEqual(
      expect.arrayContaining(["https://cdn.example/char.jpg", "https://cdn.example/scene.jpg"]),
    );
    expect(key.prompt).toMatch(/用户垫图|融图参考|自传人物/);
    const next = applyFactoryPrefsToBlocks(blocks, {
      characterIds: ["char_f_02"],
      sceneId: "scene_04",
      artStyleId: "photoreal",
      customRefs,
      craftShotIds: [],
      motionPromptIds: [],
    });
    const key2 = next.find((b) => b.id.startsWith("keyart-"))!;
    expect(key2.imageMode).toBe("edit");
    expect(key2.prompt).toMatch(/用户垫图|融图参考|自传/);
  });

  it("spawn injects art style into bible and keyart", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "仙侠权谋",
      characterIds: ["char_f_01", "char_m_02"],
      artStyleId: "cg_drama",
    });
    const bible = blocks.find((b) => b.id.startsWith("bible-"))!.prompt;
    expect(bible).toContain("CG 漫剧");
    const keyart = blocks.find((b) => b.id.startsWith("keyart-"))!.prompt;
    expect(keyart).toContain("【画风硬锁】");
  });

  it("applyFactoryPrefs keeps craft when only scene changes", () => {
    const { blocks } = spawnManhuaDramaStudio({
      genreId: "xianxia",
      sceneId: "scene_01",
      topic: "外门弟子",
      craftShotIds: ["light_03_high_contrast"],
    });
    const next = applyFactoryPrefsToBlocks(blocks, {
      sceneId: "scene_04",
      craftShotIds: ["light_03_high_contrast"],
      motionPromptIds: [],
    });
    const beats = next.find((b) => b.id.startsWith("beats-"))!.prompt;
    expect(beats).toContain("秘境洞府");
    expect(beats).toContain("高反差");
  });

  it("infers genre from topic when genreId omitted", () => {
    const spawned = spawnManhuaDramaStudio({
      topic: "星际飞船舷窗离别",
    });
    expect(spawned.genreInferred).toBe(true);
    expect(spawned.resolvedGenreId).toBe("scifi");
    expect(spawned.blocks[0]!.prompt).toContain("科幻");
    // ⑤D：题材「飞船/舷窗」细匹配太空基地，而非科幻默认「未来城市」
    expect(spawned.blocks.find((b) => b.id.startsWith("keyart-"))!.prompt).toContain("太空基地");
  });

  it("keeps scene asset in keyart after reverse enrich", async () => {
    const spawned = spawnManhuaDramaStudio({
      genreId: "xianxia",
      sceneId: "scene_04",
      topic: "闯秘境",
    });
    // 预置上游文本段为 done，只跑反推以触发 enrich
    const primed = spawned.blocks.map((b) => {
      if (b.id.startsWith("story-") || b.id.startsWith("bible-") || b.id.startsWith("beats-")) {
        return { ...b, status: "done" as const, outputText: "上游已完成\n角色：青衫弟子" };
      }
      return b;
    });
    const deps: CanvasRunDeps = {
      optimizeCopy: async () => "unused",
    };
    // mock runCanvasBlock via monkey: pipeline calls runCanvasBlock from module — use real reverse path by stubbing is heavy;
    // instead call enrich indirectly: mark reverse done through pipeline with a fake by patching fetch is too heavy.
    // Use extract + manual map check via pipeline with injected done reverse:
    const withReverse = primed.map((b) =>
      b.id.startsWith("reverse-")
        ? {
            ...b,
            status: "done" as const,
            outputText: `## 一句话摘要\n秘境一战\n\n## 可复制总提示（首镜）\nslow push, crystal glow`,
          }
        : b,
    );
    // force re-run reverse with mock: simplest — import and rely on runManhuaDramaFactoryPipeline calling runCanvasBlock
    // We'll stub by making reverse already done and forceFromStage keyart only — enrich only runs after reverse run.
    // So simulate one reverse run with a deps that won't be used if we unit-test strip via spawn+manual:
    const keyBefore = withReverse.find((b) => b.id.startsWith("keyart-"))!.prompt;
    expect(keyBefore).toContain("秘境洞府");

    const { runCanvasBlock } = await import("./canvasRunBlock");
    const original = runCanvasBlock;
    // dynamic mock: pipeline imports runCanvasBlock at top — can't easily replace.
    // Fall back: invoke pipeline until reverse with a custom approach — skip if not mockable.
    // Directly exercise by re-exporting enrich is private; use pipeline with forceFromStage reverse and mock global fetch.
    const reverseMd = `## 一句话摘要
秘境一战

## 分镜表
| 1 | 近景 | 石门 |

## 可复制总提示（首镜）
slow push, crystal glow
`;
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("geminiScript") || url.includes("videoReverse")) {
        return new Response(
          JSON.stringify({
            ok: true,
            text: reverseMd,
            markdown: reverseMd,
            raw: { candidates: [{ content: { parts: [{ text: reverseMd }] } }] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return prevFetch(input, init);
    }) as typeof fetch;

    try {
      const result = await runManhuaDramaFactoryPipeline({
        deps,
        blocks: primed,
        edges: spawned.edges,
        untilStage: "reverse",
        forceFromStage: "reverse",
        skipDone: true,
        maxRetries: 0,
      });
      const key = result.blocks.find((b) => b.id.startsWith("keyart-"))!;
      // 源头短包：反推完成后不再把反推/bible 长文叠进静帧
      expect(key.prompt).toContain("【静帧·源头短包】");
      expect(key.prompt).toContain("秘境洞府");
      expect(key.prompt).not.toContain("来自编导反推");
      expect(key.prompt).not.toContain("角色外形锚点·禁字");
      expect(key.prompt).not.toContain("发光晶石");
    } finally {
      globalThis.fetch = prevFetch;
      void original;
    }
  });

  it("orders ids through reverse / keyart / clip", () => {
    const { blocks } = spawnManhuaDramaStudio();
    expect(resolveManhuaFactoryOrderedIds(blocks, "reverse")).toHaveLength(4);
    expect(resolveManhuaFactoryOrderedIds(blocks, "keyart")).toHaveLength(5);
    expect(resolveManhuaFactoryOrderedIds(blocks, "clip")).toHaveLength(6);
  });

  it("limits a manual rerun to the selected shot keyart", () => {
    const ordered = [
      "story-e01-a",
      "reverse-e01-a",
      "keyart-e01-s01-a",
      "keyart-e01-s02-a",
      "clip-e01-a",
    ];
    expect(filterManhuaFactoryTargetIds(ordered, ["keyart-e01-s02-a"])).toEqual([
      "keyart-e01-s02-a",
    ]);
    expect(filterManhuaFactoryTargetIds(ordered)).toEqual(ordered);
  });

  it("applies topic to existing story node", () => {
    const { blocks } = spawnManhuaDramaStudio();
    const next = applyTopicToFactoryStory(blocks, "雨夜天台");
    expect(next.find((b) => b.id.startsWith("story-"))!.prompt).toContain("雨夜天台");
  });

  it("extracts motion hints from reverse markdown", () => {
    const md = `## 一句话摘要
星际离别的青涩痛感

## 分镜表
| 镜号 | 景别 | 内容 |
| 1 | 近景 | 雨夜月台对视 |

## 角色与场景锁定
女主短发校服，男主黑伞

## Seedance / I2V 微动提示词（每镜一句）
1. slow push on face

## 可复制总提示（首镜）
slow dolly in, soft rain, trembling hand
`;
    const h = extractFactoryMotionHints(md);
    expect(h.keyArtHint).toContain("星际离别");
    expect(h.keyArtHint).toContain("雨夜月台");
    expect(h.keyArtHint).toContain("短发校服");
    expect(h.seedanceHint).toContain("slow dolly");
  });

  it("detects transient errors and resume stage", () => {
    expect(isTransientFactoryError("网关超时，请稍后重试")).toBe(true);
    expect(isTransientFactoryError("算力紧张，请稍后重试（503）")).toBe(true);
    expect(isTransientFactoryError("Failed to fetch")).toBe(true);
    expect(isTransientFactoryError("TypeError: fetch failed")).toBe(true);
    expect(isTransientFactoryError("积分不足")).toBe(false);
    const { blocks } = spawnManhuaDramaStudio();
    const withError = blocks.map((b) =>
      b.id.startsWith("beats-")
        ? { ...b, status: "error" as const, error: "timeout" }
        : b.id.startsWith("story-") || b.id.startsWith("bible-")
          ? { ...b, status: "done" as const, outputText: "ok" }
          : b,
    );
    expect(resolveFactoryResumeStage(withError)).toBe("beats");
  });

  it("spawns series with staggered rows, eXX ids, and previous ending hook", () => {
    const { blocks, edges, episodeCount, episodeIndexes } = spawnManhuaDramaStudioSeries({
      topic: "仙侠外门闯秘境",
      genreId: "xianxia",
      episodes: [
        { index: 1, title: "石门异响", body: "听见异响", endHook: "门缝透出冷光" },
        { index: 2, title: "冷光之后", body: "推门", endHook: "身后有人叫她本名" },
        { index: 3, title: "本名", body: "回头", endHook: "玉佩碎裂" },
      ],
      writerContextForEpisode: (ep) => `【本集优先】第${ep.index}集《${ep.title}》\n${ep.body || ""}`,
      rowGap: 400,
      originY: 40,
    });
    expect(episodeCount).toBe(3);
    expect(episodeIndexes).toEqual([1, 2, 3]);
    // 6+6+7（第3集多前情提要 recap_card；不再铺 omni_edit；每集 5 条边）
    expect(blocks).toHaveLength(19);
    expect(edges).toHaveLength(15);

    const stories = blocks.filter((b) => b.id.startsWith("story-"));
    expect(stories).toHaveLength(3);
    expect(stories.every((b) => /story-e0[123]-/.test(b.id))).toBe(true);
    expect(stories.map((b) => b.episodeIndex)).toEqual([1, 2, 3]);
    expect(stories[0]!.y).toBe(40);
    expect(stories[1]!.y).toBe(440);
    expect(stories[2]!.y).toBe(840);

    expect(stories[0]!.prompt).toContain("第1集·石门异响");
    expect(stories[0]!.prompt).not.toContain("【上集钩子】");
    expect(stories[1]!.prompt).toContain("【上集钩子】门缝透出冷光");
    expect(stories[2]!.prompt).toContain("【上集钩子】身后有人叫她本名");
    expect(stories[2]!.prompt).toContain("【前情提要·片头】");
    expect(blocks.some((b) => b.id.startsWith("recap_card-e03-"))).toBe(true);

    const ep2 = filterBlocksByEpisode(blocks, 2);
    expect(ep2).toHaveLength(6);
    expect(resolveManhuaFactoryOrderedIds(blocks, "clip", 2).every((id) => id.includes("-e02-"))).toBe(
      true,
    );
    expect(getBlockEpisodeIndex(ep2[0]!)).toBe(2);
  });

  it("caps series spawn at 4 episodes", () => {
    const eps = [1, 2, 3, 4, 5, 6].map((i) => ({
      index: i,
      title: `集${i}`,
      endHook: `钩子${i}`,
    }));
    const { episodeCount, blocks } = spawnManhuaDramaStudioSeries({
      topic: "连载",
      episodes: eps,
    });
    expect(episodeCount).toBe(4);
    expect(blocks.filter((b) => b.id.startsWith("story-"))).toHaveLength(4);
  });

  it("manhuaEpisodeHasFactoryChain detects missing focus episode chain", () => {
    const series = spawnManhuaDramaStudioSeries({
      topic: "仙侠",
      episodes: [
        { index: 1, title: "一", endHook: "钩A" },
        { index: 2, title: "二", endHook: "钩B" },
      ],
    });
    expect(manhuaEpisodeHasFactoryChain(series.blocks, 1)).toBe(true);
    expect(manhuaEpisodeHasFactoryChain(series.blocks, 2)).toBe(true);
    const onlyEp1 = series.blocks.filter((b) => getBlockEpisodeIndex(b) === 1);
    expect(manhuaEpisodeHasFactoryChain(onlyEp1, 1)).toBe(true);
    expect(manhuaEpisodeHasFactoryChain(onlyEp1, 2)).toBe(false);
  });

  it("resolveManhuaEpisodeSpawnContinuity mirrors series prior hooks/recap", () => {
    const eps = [
      { index: 1, title: "石门异响", body: "听见异响", endHook: "门缝透出冷光" },
      { index: 2, title: "冷光之后", body: "推门", endHook: "身后有人叫她本名" },
      { index: 3, title: "本名", body: "回头", endHook: "玉佩碎裂" },
    ];
    const c2 = resolveManhuaEpisodeSpawnContinuity(eps, 2);
    expect(c2.previousEndingHook).toBe("门缝透出冷光");
    expect(c2.previouslyOnRecap).toBeUndefined();
    const c3 = resolveManhuaEpisodeSpawnContinuity(eps, 3);
    expect(c3.previousEndingHook).toBe("身后有人叫她本名");
    expect(c3.previouslyOnRecap).toContain("【前情提要·片头】");
    expect(c3.previouslyOnRecap).toContain("门缝透出冷光");
  });

  it("ep3 recap_card does not parent/edge into story (no vision poison)", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "石门",
      seriesTitle: "石门冷光",
      episodeIndex: 3,
      episodeTitle: "本名",
      previousEndingHook: "身后有人叫她本名",
      previouslyOnRecap: "【前情提要·片头】\n- 第1集要点",
      artStyleId: "photoreal",
    });
    const story = blocks.find((b) => b.id.startsWith("story-"))!;
    const recap = blocks.find((b) => b.id.startsWith("recap_card-"))!;
    expect(story.parentId).toBeFalsy();
    expect(edges.some((e) => e.fromId === recap.id || e.toId === recap.id)).toBe(false);
    expect(story.prompt).toContain("【前情提要·片头】");

    const withRecapOut = blocks.map((b) =>
      b.id === recap.id
        ? { ...b, status: "done" as const, outputUrl: "https://cdn.example/recap.jpg" }
        : b,
    );
    const keyart = withRecapOut.find((b) => b.id.startsWith("keyart-"))!;
    expect(collectVisionImages(story.id, withRecapOut, edges).map((x) => x.url)).not.toContain(
      "https://cdn.example/recap.jpg",
    );
    expect(resolveNearestUpstreamImageUrl(keyart.id, withRecapOut, edges)).not.toBe(
      "https://cdn.example/recap.jpg",
    );
  });

  it("applyFactoryPrefsToBlocks syncs art style onto recap_card", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "石门",
      episodeIndex: 3,
      previouslyOnRecap: "【前情提要·片头】\n- 要点",
      artStyleId: "photoreal",
    });
    const next = applyFactoryPrefsToBlocks(blocks, {
      artStyleId: "cg_drama",
      craftShotIds: [],
      motionPromptIds: [],
    });
    const recap = next.find((b) => b.id.startsWith("recap_card-"))!.prompt;
    expect(recap).toContain("【画风硬锁】");
    expect(recap).toContain("CG 漫剧");
    expect(recap.match(/【画风硬锁】/g)?.length).toBe(1);
  });

  it("sanitizeManhuaRecapUpstreamLinks strips legacy recap→story links", () => {
    const { blocks, edges } = spawnManhuaDramaStudio({
      topic: "石门",
      episodeIndex: 3,
      previouslyOnRecap: "【前情提要·片头】\n- 要点",
    });
    const recap = blocks.find((b) => b.id.startsWith("recap_card-"))!;
    const story = blocks.find((b) => b.id.startsWith("story-"))!;
    const poisonedBlocks = blocks.map((b) =>
      b.id === story.id ? { ...b, parentId: recap.id } : b,
    );
    const poisonedEdges = [...edges, { fromId: recap.id, toId: story.id }];
    const cleaned = sanitizeManhuaRecapUpstreamLinks(poisonedBlocks, poisonedEdges);
    expect(cleaned.blocks.find((b) => b.id === story.id)!.parentId).toBeUndefined();
    expect(cleaned.edges.some((e) => e.fromId === recap.id)).toBe(false);
  });

  it("replaceManhuaEpisodeChain keeps other episodes", () => {
    const series = spawnManhuaDramaStudioSeries({
      topic: "仙侠",
      genreId: "xianxia",
      episodes: [
        { index: 1, title: "一", endHook: "钩A" },
        { index: 2, title: "二", endHook: "钩B" },
      ],
      rowGap: 400,
    });
    const ep1StoryBefore = series.blocks.find((b) => b.id.startsWith("story-e01-"))!;
    const continuity = resolveManhuaEpisodeSpawnContinuity(
      [
        { index: 1, title: "一", endHook: "钩A" },
        { index: 2, title: "二改", endHook: "钩B2" },
      ],
      2,
    );
    const respawn = spawnManhuaDramaStudio({
      topic: "仙侠",
      genreId: "xianxia",
      originY: 440,
      ...continuity,
      previousEndingHook: continuity.previousEndingHook,
    });
    const merged = replaceManhuaEpisodeChain(series.blocks, series.edges, respawn, 2);
    expect(merged.blocks.find((b) => b.id === ep1StoryBefore.id)).toBeTruthy();
    expect(merged.blocks.filter((b) => getBlockEpisodeIndex(b) === 1)).toHaveLength(6);
    expect(merged.blocks.filter((b) => getBlockEpisodeIndex(b) === 2)).toHaveLength(6);
    const ep2Story = merged.blocks.find((b) => b.id.startsWith("story-e02-"))!;
    expect(ep2Story.prompt).toContain("【上集钩子】钩A");
    expect(ep2Story.episodeTitle).toBe("二改");
  });

  it("stripManhuaFactoryCanvasArtifacts drops factory/keyart but keeps free nodes", () => {
    const factory = spawnManhuaDramaStudio({ topic: "旧剧", episodeIndex: 1, episodeTitle: "旧" });
    const free = {
      ...factory.blocks[0]!,
      id: "text-free-note",
      kind: "text" as const,
      prompt: "自由备注",
      episodeIndex: undefined,
    };
    const withAsset = [
      ...factory.blocks,
      free,
      {
        ...factory.blocks[0]!,
        id: "charsheet-arch_old",
        kind: "image" as const,
        outputUrl: "https://cdn.example/old.jpg",
      },
    ];
    const edges = [
      ...factory.edges,
      { fromId: free.id, toId: factory.blocks[0]!.id },
    ];
    const cleaned = stripManhuaFactoryCanvasArtifacts(withAsset, edges);
    expect(cleaned.removedCount).toBeGreaterThan(0);
    expect(cleaned.blocks.map((b) => b.id)).toEqual(["text-free-note"]);
    expect(cleaned.edges).toHaveLength(0);
    expect(cleaned.blocks.some((b) => b.id.startsWith("keyart-"))).toBe(false);
  });

  it("exposes keyart parallel concurrency > 1", () => {
    expect(MANHUA_KEYART_PARALLEL_CONCURRENCY).toBeGreaterThanOrEqual(2);
  });

  it("publishes each keyart as it finishes (batch parallel, no hard prev-still wait)", async () => {
    const spawned = spawnManhuaDramaStudio({ topic: "雨夜对峙" });
    const reverseId = spawned.blocks.find((b) => b.id.startsWith("reverse-"))!.id;
    const reverseMd = `## 分镜表
| 镜号 | 景别 | 内容 | 时长 |
| 1 | 近景 | 雨夜对视 | 2.5 |
| 2 | 中景 | 拔刀 | 2.5 |
| 3 | 全景 | 追击 | 2.5 |
`;
    const primed = spawned.blocks.map((b) => {
      if (b.id.startsWith("story-") || b.id.startsWith("bible-") || b.id.startsWith("beats-")) {
        return { ...b, status: "done" as const, outputText: "上游已完成" };
      }
      if (b.id.startsWith("reverse-")) {
        return { ...b, status: "done" as const, outputText: reverseMd };
      }
      return b;
    });
    const expanded = expandManhuaShotKeyartsAfterReverse(primed, spawned.edges, reverseId);
    const keyarts = expanded.blocks.filter((b) => b.id.startsWith("keyart-"));
    expect(keyarts.length).toBeGreaterThanOrEqual(3);
    // 批量闸门要求有垫图；测试补上站点相对参考，避免未挂垫图被预检拦下
    const withPads = expanded.blocks.map((b) =>
      b.id.startsWith("keyart-")
        ? {
            ...b,
            imageMode: "edit" as const,
            refImageUrl: "/manhua-scenes/pad.webp",
            editFusionUrls: ["/manhua-props/pad.png"],
          }
        : b,
    );

    const doneOrder: string[] = [];
    const inFlightPeaks: number[] = [];
    let inFlight = 0;
    const spy = vi.spyOn(canvasRunBlock, "runCanvasBlock").mockImplementation(async (_deps, block) => {
      if (!block.id.startsWith("keyart-")) {
        return { outputText: "skip" };
      }
      inFlight += 1;
      inFlightPeaks.push(inFlight);
      const delay = block.id.includes("-s01") ? 60 : block.id.includes("-s02") ? 10 : 30;
      await new Promise((r) => setTimeout(r, delay));
      inFlight -= 1;
      return { outputUrl: `https://cdn.example/${block.id}.png` };
    });

    try {
      const deps: CanvasRunDeps = { optimizeCopy: async () => "" };
      await runManhuaDramaFactoryPipeline({
        deps,
        blocks: withPads,
        edges: expanded.edges,
        untilStage: "keyart",
        forceFromStage: "keyart",
        skipDone: true,
        maxRetries: 0,
        shotContinuity: { keyartFromPrevStill: true },
        onBlocksChange: (next) => {
          const freshlyDone = next
            .filter((b) => b.id.startsWith("keyart-") && b.status === "done" && b.outputUrl)
            .map((b) => b.id)
            .filter((id) => !doneOrder.includes(id));
          doneOrder.push(...freshlyDone);
        },
      });

      // s02 更快：应先于 s01 出现在渐进 publish 里（若严格串行则必为 s01→s02→s03）
      expect(doneOrder.length).toBeGreaterThanOrEqual(3);
      expect(doneOrder[0]).toMatch(/-s02/);
      expect(Math.max(...inFlightPeaks)).toBeGreaterThanOrEqual(2);
      // 批量并行：可加软一致提示；若节点已有垫图/融图，不得改成 generate 并清空 refs
      const keyartCalls = spy.mock.calls.filter(([_, b]) => b.id.startsWith("keyart-"));
      expect(
        keyartCalls.some(
          ([_, b]) => String(b.prompt || "").includes("同集静帧一致性"),
        ),
      ).toBe(true);
      expect(
        keyartCalls
          .filter(([_, b]) => String(b.prompt || "").includes("同集静帧一致性"))
          .every(([_, b]) => {
            const hasPad =
              Boolean(b.refImageUrl) || Boolean(b.editFusionUrls && b.editFusionUrls.length);
            if (!hasPad) return true;
            return b.imageMode === "edit";
          }),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("rerun skips keyarts that already have images even with forceFromStage", async () => {
    const spawned = spawnManhuaDramaStudio({ topic: "宫廷夺嫡", episodeIndex: 1 });
    const reverseId = spawned.blocks.find((b) => b.id.startsWith("reverse-"))!.id;
    const primed = spawned.blocks.map((b) => {
      if (b.id.startsWith("story-") || b.id.startsWith("bible-") || b.id.startsWith("beats-")) {
        return { ...b, status: "done" as const, outputText: "上游已完成" };
      }
      if (b.id.startsWith("reverse-")) {
        return { ...b, status: "done" as const, outputText: "1. 入殿\n2. 对峙\n3. 退场" };
      }
      return b;
    });
    const expanded = expandManhuaShotKeyartsAfterReverse(primed, spawned.edges, reverseId);
    const keyarts = expanded.blocks.filter((b) => b.id.startsWith("keyart-"));
    expect(keyarts.length).toBeGreaterThanOrEqual(3);
    const withPartial = expanded.blocks.map((b) => {
      if (!b.id.startsWith("keyart-")) return b;
      const shot = resolveKeyartShotIndex(b.id, b.prompt);
      const withPad = {
        ...b,
        imageMode: "edit" as const,
        refImageUrl: "/manhua-scenes/pad.webp",
        editFusionUrls: ["/manhua-props/pad.png"],
      };
      if (shot === 1) {
        return {
          ...withPad,
          status: "done" as const,
          outputUrl: "https://cdn.example/s01.png",
        };
      }
      if (shot === 2) {
        return {
          ...withPad,
          status: "error" as const,
          error: "改图失败",
          outputUrl: undefined,
        };
      }
      return { ...withPad, status: "idle" as const, outputUrl: undefined };
    });

    const spy = vi.spyOn(canvasRunBlock, "runCanvasBlock").mockImplementation(async (_deps, block) => {
      if (!block.id.startsWith("keyart-")) return { outputText: "skip" };
      return { outputUrl: `https://cdn.example/${block.id}.png` };
    });

    try {
      const result = await runManhuaDramaFactoryPipeline({
        deps: { optimizeCopy: async () => "" },
        blocks: withPartial,
        edges: expanded.edges,
        untilStage: "keyart",
        forceFromStage: "keyart",
        skipDone: true,
        maxRetries: 0,
      });
      const keyartCalls = spy.mock.calls.filter(([_, b]) => b.id.startsWith("keyart-"));
      expect(
        keyartCalls.every(([_, b]) => resolveKeyartShotIndex(b.id, b.prompt) !== 1),
      ).toBe(true);
      expect(
        keyartCalls.some(([_, b]) => resolveKeyartShotIndex(b.id, b.prompt) === 2),
      ).toBe(true);
      expect(
        result.skippedIds.some((id) => {
          const b = withPartial.find((x) => x.id === id);
          return b ? resolveKeyartShotIndex(b.id, b.prompt) === 1 : false;
        }),
      ).toBe(true);
      const s01 = result.blocks.find(
        (b) => b.id.startsWith("keyart-") && resolveKeyartShotIndex(b.id, b.prompt) === 1,
      );
      expect(s01?.outputUrl).toBe("https://cdn.example/s01.png");
    } finally {
      spy.mockRestore();
    }
  });

  it("prefs refresh keeps existing keyart pad when new plan has no base", () => {
    const { blocks } = spawnManhuaDramaStudio({
      topic: "江湖刀客雨夜客栈",
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      sceneId: "scene_07",
      propIds: ["demo_prop_ancient_jade"],
      artStyleId: "photoreal",
    });
    const keyed = blocks.map((b) =>
      b.id.startsWith("keyart-")
        ? {
            ...b,
            imageMode: "edit" as const,
            refImageUrl: "/manhua-scenes/keep.webp",
            editFusionUrls: ["/manhua-props/keep.png"],
          }
        : b,
    );
    // 故意不传 scene/prop，模拟 prefs 瞬时算不出底图
    const next = applyFactoryPrefsToBlocks(keyed, {
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      artStyleId: "photoreal",
    });
    const key = next.find((b) => b.id.startsWith("keyart-"))!;
    expect(key.imageMode).toBe("edit");
    expect(key.refImageUrl).toBe("/manhua-scenes/keep.webp");
    expect(key.editFusionUrls).toContain("/manhua-props/keep.png");
  });

  it("expand only adds missing shots and keeps existing media", () => {
    const spawned = spawnManhuaDramaStudio({ topic: "雨夜江湖", episodeIndex: 1 });
    const reverse = spawned.blocks.find((b) => b.id.startsWith("reverse-"))!;
    const withTwo = spawned.blocks.map((b) =>
      b.id === reverse.id
        ? { ...b, status: "done" as const, outputText: "1. 推门\n2. 对峙" }
        : b,
    );
    const first = expandManhuaShotKeyartsAfterReverse(withTwo, spawned.edges, reverse.id);
    const marked = first.blocks.map((b) =>
      b.id.startsWith("keyart-") && resolveKeyartShotIndex(b.id, b.prompt) === 1
        ? { ...b, status: "done" as const, outputUrl: "https://cdn.example/keep.png" }
        : b,
    );
    const grown = marked.map((b) =>
      b.id === reverse.id
        ? { ...b, outputText: "1. 推门\n2. 对峙\n3. 拔刀\n4. 收刀" }
        : b,
    );
    const expanded = expandManhuaShotKeyartsAfterReverse(grown, first.edges, reverse.id);
    const keys = expanded.blocks.filter((b) => b.id.startsWith("keyart-"));
    expect(keys.length).toBe(4);
    const s01 = keys.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === 1);
    expect(s01?.outputUrl).toBe("https://cdn.example/keep.png");
    expect(keys.filter((b) => resolveKeyartShotIndex(b.id, b.prompt) === 1)).toHaveLength(1);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
