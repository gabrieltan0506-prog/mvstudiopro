import { describe, expect, it } from "vitest";
import {
  isManhuaClipPromptLegacyFat,
  renderManhuaClipPromptForSeedance,
  stripManhuaClipForbiddenBoards,
  stripManhuaStaleAssetBindForModel,
} from "./manhuaClipPromptSanitize";

describe("manhuaClipPromptSanitize", () => {
  /**
   * 官方符号表：（）音乐、<>音效、{}台词、【】字幕。拿【】当段落标题等于叫
   * 引擎把「场景锁」这类内部字段烧进画面。
   */
  it("换成官方符号：【】不再当段落标题，台词走 {}", () => {
    const out = renderManhuaClipPromptForSeedance(
      [
        "【第1段·15s】断月桥",
        "【场景锁】断月桥；配色：墨蓝雨夜。",
        "0–5s：动作轨迹：拔刀，眼神转硬。景别：近景。@角色2以压嗓说「站住」。",
      ].join("\n"),
    );

    expect(out).not.toMatch(/[【】]/);
    expect(out).not.toMatch(/[「」]/);
    expect(out).toContain("[第1段·15s]断月桥");
    expect(out).toContain("[场景锁]");
    expect(out).toContain("以压嗓说{站住}");
    // 正文一个字都不该丢
    expect(out).toContain("墨蓝雨夜");
    expect(out).toContain("动作轨迹：拔刀，眼神转硬");
  });

  it("只在出线那一步换：存稿仍靠【】断段与解析", () => {
    const stored = "【第1段·15s】桥\n【垫图】本段静帧2张";
    // 转换后的文本不该再喂回内部解析器——这里只验转换本身不改原串
    expect(renderManhuaClipPromptForSeedance(stored)).not.toBe(stored);
    expect(stored).toContain("【第1段·15s】");
    expect(isManhuaClipPromptLegacyFat("【节拍防火墙】x")).toBe(true);
  });
  it("detects legacy fat clip prompts", () => {
    expect(
      isManhuaClipPromptLegacyFat("【节拍防火墙】\n当前只拍第 1 段"),
    ).toBe(true);
    expect(
      isManhuaClipPromptLegacyFat(
        "【第1段·15s】雨夜\n0–15s：@角色1，拔刀，说「站住」。近景。",
      ),
    ).toBe(false);
  });

  it("strips ancient boards and director walls; keeps slim timeline + Image bind", () => {
    const fat = [
      "有参考图时写完整视频导戏单（一轮约 15 秒）",
      "【节拍防火墙】",
      "当前只拍第 1 段",
      "【第 1 段·成片】",
      "目标时长：约 15 秒",
      "【视频生成导戏单·第1段·一轮】",
      "分镜1｜中远景",
      "【按秒导戏单·第01段·15s】",
      "0–5s｜起幅｜全景",
      "【成片有声与导戏硬锁】",
      "1. 有声：有对白",
      "【跨镜连续硬锁·防崩】",
      "1. 脸：五官",
      "【成片预演硬锁】",
      "1. 形象连续",
      "【古风服化参考】",
      "1. 【古风原型·设计板】雨夜江湖刀客（arch_rain_jianghu_dao）",
      "【身份与时代·跟剧本】",
      "- 严格遵循",
      "【第1段·15s】雨夜桥板",
      "0–15s：@角色1，踩灭箭火，说「趴下」。近景。",
      "【垫图】本段静帧3张",
      "【资产·Image对照】",
      "@角色1|id=hero|label=剑客|kind=角色",
      "@场景1|id=bridge|label=雨桥|kind=场景",
      "【路径运镜配方】",
      "硬规则：每镜一个主运镜",
      "【点选道具锚点】",
      "- 传家玉佩 · /manhua-props/demo.jpg",
    ].join("\n");
    const out = stripManhuaClipForbiddenBoards(fat);
    expect(out).toContain("【第1段·15s】");
    expect(out).toContain("@角色1");
    expect(out).toContain("【资产·Image对照】");
    expect(out).toContain("【垫图】");
    expect(out).not.toMatch(/节拍防火墙|古风服化|视频生成导戏单|按秒导戏单|成片预演|路径运镜|点选道具|arch_rain/);
    expect(isManhuaClipPromptLegacyFat(out)).toBe(false);
  });

  it("strips 画风 lines from clip prompts", () => {
    const withArt = [
      "【第1段·15s】雨夜桥板",
      "0–15s：@角色1，拔刀。近景。",
      "【垫图】本段静帧3张",
      "画风：CG 漫剧",
    ].join("\n");
    const out = stripManhuaClipForbiddenBoards(withArt);
    expect(out).toContain("【第1段·15s】");
    expect(out).not.toMatch(/画风：/);
  });

  it("drops the stored asset/bind snapshots so only the runtime @Image map survives", () => {
    // 取自线上第1段：节点里存的硬绑说 @Image5=韩廷玉，实算却只送得进 4 张
    const stored = [
      "【第1段·15s】断月桥",
      "【场景锁】断月桥。地点材质光色锁本段垫图，禁止跳棚换地。",
      "0–5s：动作轨迹：火箭钉入桥板。运镜轨迹：缓慢推近。景别：全景。",
      "【垫图】本段静帧3张，其中1张按序绑@Image",
      "【资产·Image对照】",
      "@角色1|id=cust_mrwxm9q3_qcioz|label=马县丞|kind=角色",
      "@角色2|id=cust_mrwxptnw_wnzlo|label=苏文谦|kind=角色",
      "【出片Image硬绑】",
      "@角色1=@Image1（马县丞） id=cust_mrwxm9q3_qcioz；@角色5=@Image5（韩廷玉）。",
      "【本段造型】常服",
    ].join("\n");

    const out = stripManhuaStaleAssetBindForModel(stored);
    expect(out).not.toContain("【资产·Image对照】");
    expect(out).not.toContain("【出片Image硬绑】");
    expect(out).not.toContain("cust_mrwxm9q3_qcioz");
    expect(out).not.toContain("@Image5");
    // 秒轴、场景锁、垫图说明、造型都要留住
    expect(out).toContain("【第1段·15s】断月桥");
    expect(out).toContain("【场景锁】");
    expect(out).toContain("0–5s：动作轨迹：火箭钉入桥板");
    expect(out).toContain("【垫图】本段静帧3张");
    expect(out).toContain("【本段造型】常服");
  });

  it("leaves a prompt without the snapshots untouched", () => {
    const clean = ["【第1段·15s】断月桥", "0–5s：动作轨迹：火箭钉入桥板。"].join("\n");
    expect(stripManhuaStaleAssetBindForModel(clean)).toBe(clean);
  });

  it("导演板信息压在【垫图】单行内，肥稿走兜底路径时 URL 与箭头声明仍在", () => {
    // 老草稿含「节拍防火墙」等关键词会触发 LEGACY_FAT_RE，走 :143 附近的兜底路径——
    // 该路径用 /【垫图[^\n]*/ 只吃一行，导演板信息必须压成单行才能存活。
    const fat = [
      "有参考图时写完整视频导戏单（一轮约 15 秒）",
      "【节拍防火墙】",
      "当前只拍第 1 段",
      "【第1段·15s】雁门关城墙",
      "0–15s：@角色1，翻墙，说「进」。近景。",
      "【垫图】本段静帧3张（出片顺序：资产定妆/服装→本段静帧→上段末帧，按序绑@图片N）｜导演板：红箭头=人物/道具动向，青箭头=镜头运镜，青虚线=竖屏安全框，均为拍摄引导，不得出现在成片画面｜https://cdn.example/board-main.png",
      "【连续】接上段末帧。",
    ].join("\n");
    const out = stripManhuaClipForbiddenBoards(fat);
    expect(out).toContain("【垫图】");
    expect(out).toContain("https://cdn.example/board-main.png");
    expect(out).toContain("不得出现在成片画面");
    expect(out).toContain("红箭头");
    expect(out).toContain("青箭头");
    // 后续块不受影响
    expect(out).toContain("【连续】");
    expect(out).not.toMatch(/节拍防火墙/);
  });

  it("剪辑手法块不该糊在审阅面上", () => {
    // 这一层是出片那一刻现拼的：人在审阅栏要读的是谁在做什么，不是怎么剪
    const raw = [
      "【第1段·15s】断月桥",
      "0–5s：中景，她说「我不会认输」。",
      "【剪辑手法】",
      "切点卡情绪不卡秒；关键台词落地后停约 0.2 秒再切。",
      "本段同一场景内一律直切，禁止转场特效。",
      "【连续】接上段末帧。",
    ].join("\n");
    const out = stripManhuaClipForbiddenBoards(raw);
    expect(out).toContain("0–5s：中景");
    expect(out).not.toContain("剪辑手法");
    expect(out).not.toContain("0.2 秒");
    // 后面的板不能被顺手吃掉
    expect(out).toContain("【连续】");
  });
});
