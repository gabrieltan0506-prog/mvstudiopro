import { describe, expect, it } from "vitest";
import { buildManhuaWriterAssetCanon } from "@shared/manhuaWriterAssetCanon";
import type { ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import { buildManhuaStoryAssetRefreshPrompt, parseManhuaStoryAssetRefresh } from "./manhuaStoryAssetRefresh";

const pack: ManhuaWriterPack = {
  seriesTitle: "湖边旧约", logline: "湖边赴约", episodeCount: 2, rawMarkdown: "原完整剧本，不能被替换",
  charactersMd: "- 沈砚舟/沈少主｜二十岁黑发青年，青衫｜守旧约｜与云疏冷相识｜不滥杀\n- 云疏冷｜银发女子，白衣｜寻故人｜与沈砚舟相识｜不背信",
  propsMd: "- 玉扣｜信物｜白玉双鹤扣",
  locationsMd: "- 湖边｜安静｜石桥残荷\n- 破庙｜阴冷｜断梁神像",
  episodes: [
    { index: 1, title: "赴约", body: "沈砚舟换上玄色长袍，带玉扣在湖边等云疏冷。", endHook: "脚步近了" },
    { index: 2, title: "旧事", body: "云疏冷独自进入破庙。", endHook: "神像裂开" },
  ],
};
const source = { pack, changedEpisodeIndexes: [1] };
const markdown = (tables: Partial<ManhuaWriterPack> = {}) => `## 人物表\n${tables.charactersMd || pack.charactersMd}\n\n## 道具表\n${tables.propsMd || pack.propsMd}\n\n## 场景表\n${tables.locationsMd || pack.locationsMd}`;

describe("剧情改后资产更新纯合同", () => {
  it("prompt包含完整正文和旧三表，仅授权变更集资产，长正文不截断", () => {
    const body = `${"原剧情细节".repeat(10000)}末尾关键线索`;
    const prompt = buildManhuaStoryAssetRefreshPrompt({ ...source, pack: { ...pack, episodes: [{ ...pack.episodes[0], body }, pack.episodes[1]] } });
    expect(prompt).toContain(body);
    expect(prompt).toContain(pack.charactersMd);
    expect(prompt).toContain(pack.episodes[1].body);
    expect(prompt).toContain("不改写剧情");
    expect(prompt).toContain("不重新设计脸");
    expect(prompt).toContain("第1集");
  });

  it("换序与主名别名互换沿用原ID，不产生伪变更", () => {
    const previousCanon = buildManhuaWriterAssetCanon(pack);
    previousCanon.characters[0].id = "existing-identity-001";
    const charactersMd = `${pack.charactersMd.split("\n")[1]}\n${pack.charactersMd.split("\n")[0].replace("沈砚舟/沈少主", "沈少主/沈砚舟")}`;
    const result = parseManhuaStoryAssetRefresh({ ...source, previousCanon, rawMarkdown: markdown({ charactersMd }) });
    expect(result.assetCanon.characters[1].id).toBe("existing-identity-001");
    expect(result.tables.charactersMd).toContain("沈砚舟/沈少主");
    expect(result.addedAnchorIds).toEqual([]);
    expect(result.changedAnchorIds).toEqual([]);
    expect(result.characterIds).toEqual([]);
  });

  it("只列真实变化和新增锚点，变更角色单列供排除脸特写，不改原正文", () => {
    const before = JSON.stringify(pack);
    const previousCanon = buildManhuaWriterAssetCanon(pack);
    const result = parseManhuaStoryAssetRefresh({ ...source, previousCanon, rawMarkdown: markdown({
      charactersMd: pack.charactersMd.replace("青衫", "玄色长袍"),
      propsMd: `${pack.propsMd}\n- 铜钥匙｜开锁｜齿口残缺的铜钥匙`,
      locationsMd: pack.locationsMd.replace("石桥残荷", "断桥枯荷"),
    }) });
    expect(result.changedAnchorIds).toEqual([previousCanon.characters[0].id, previousCanon.locations[0].id]);
    expect(result.characterIds).toEqual([previousCanon.characters[0].id]);
    expect(result.addedAnchorIds).toHaveLength(1);
    expect(result.assetCanon.props.find(item => item.nameZh === "铜钥匙")?.id).toBe(result.addedAnchorIds[0]);
    expect(result).not.toHaveProperty("episodes");
    expect(JSON.stringify(pack)).toBe(before);
  });

  it("未改集主场景保持原映射，改动集使用新表稳定ID", () => {
    const previousCanon = buildManhuaWriterAssetCanon(pack);
    previousCanon.locations[0].id = "old-lake";
    previousCanon.locations[1].id = "old-temple";
    previousCanon.episodeMainSceneId = { 1: "old-lake", 2: "old-temple" };
    const result = parseManhuaStoryAssetRefresh({ ...source, previousCanon, rawMarkdown: markdown({ locationsMd: pack.locationsMd.split("\n").reverse().join("\n") }) });
    expect(result.assetCanon.episodeMainSceneId).toEqual({ 1: "old-lake", 2: "old-temple" });
  });

  it.each(["待补", "待定", "TODO", "占位"])("拒绝%s资产，不产生生成计划", word => {
    expect(() => parseManhuaStoryAssetRefresh({ ...source, rawMarkdown: markdown({ propsMd: `- 玉扣｜信物｜${word}` }) })).toThrow(/待补|占位/);
  });

  it("空表、少字段、夹带正文、重复表均拒绝", () => {
    for (const rawMarkdown of [markdown().replace(pack.propsMd, ""), markdown({ propsMd: "- 玉扣｜信物" }), `${markdown()}\n## 第1集\n新的剧情`, `${markdown()}\n## 人物表\n${pack.charactersMd}`]) {
      expect(() => parseManhuaStoryAssetRefresh({ ...source, rawMarkdown })).toThrow();
    }
  });

  it("遗漏旧资产和同资产双行拒绝，避免删除其他集资产或重复出图", () => {
    expect(() => parseManhuaStoryAssetRefresh({ ...source, rawMarkdown: markdown({ charactersMd: pack.charactersMd.split("\n")[0] }) })).toThrow("遗漏旧资产");
    expect(() => parseManhuaStoryAssetRefresh({ ...source, rawMarkdown: markdown({ propsMd: `${pack.propsMd}\n${pack.propsMd}` }) })).toThrow("重复改写");
  });

  it("别名指向多个旧身份时拒绝，不猜人物", () => {
    const previousCanon = buildManhuaWriterAssetCanon(pack);
    previousCanon.characters[1].aliasZh = "沈少主";
    expect(() => parseManhuaStoryAssetRefresh({ ...source, previousCanon, rawMarkdown: markdown() })).toThrow("对应多个旧资产");
  });

  it("原编译器完整模式保留超过旧数量的三表行", () => {
    const propsMd = `${pack.propsMd}\n${Array.from({ length: 16 }, (_, i) => `- 新道具${i}｜功能${i}｜铜质${i}`).join("\n")}`;
    const result = parseManhuaStoryAssetRefresh({ ...source, rawMarkdown: markdown({ propsMd }) });
    expect(result.assetCanon.props).toHaveLength(17);
    expect(result.addedAnchorIds).toHaveLength(16);
  });

  it("长规格完整进入canon和生图提示，旧上限之后的变化仍列入更新", () => {
    const firstLook = `${"金线织纹".repeat(100)}袖口为白色`;
    const updatedPack = { ...pack, charactersMd: pack.charactersMd.replace("青衫", firstLook) };
    const previousCanon = buildManhuaWriterAssetCanon({ ...updatedPack, preserveFullSpecs: true });
    const newLook = firstLook.replace("袖口为白色", "袖口为黑色");
    const result = parseManhuaStoryAssetRefresh({ ...source, pack: updatedPack, previousCanon, rawMarkdown: markdown({ charactersMd: updatedPack.charactersMd.replace(firstLook, newLook) }) });
    expect(result.assetCanon.characters[0].lookZh).toContain(newLook);
    expect(result.assetCanon.characters[0].promptZh).toContain(newLook);
    expect(result.changedAnchorIds).toEqual([previousCanon.characters[0].id]);
  });

  it("无目标集或不存在的目标集拒绝，不能猜测更新范围", () => {
    for (const changedEpisodeIndexes of [[], [3], [1.2]]) {
      expect(() => buildManhuaStoryAssetRefreshPrompt({ pack, changedEpisodeIndexes })).toThrow("有效的改动集");
      expect(() => parseManhuaStoryAssetRefresh({ pack, changedEpisodeIndexes, rawMarkdown: markdown() })).toThrow("有效的改动集");
    }
  });
});
