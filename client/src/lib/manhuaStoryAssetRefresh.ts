import { parseManhuaWriterPack, type ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import {
  buildManhuaWriterAssetCanon,
  parseWriterTableLine,
  stripMarkdownTableHeaderLines,
  type ManhuaWriterAssetAnchor,
  type ManhuaWriterAssetCanon,
} from "@shared/manhuaWriterAssetCanon";
import { normalizeForManhuaNameMatch } from "@shared/manhuaScriptTextNormalize";

type AssetTables = Pick<ManhuaWriterPack, "charactersMd" | "propsMd" | "locationsMd">;
type RefreshSource = { pack: ManhuaWriterPack; changedEpisodeIndexes: number[] };
const tableGroups = [
  ["charactersMd", "characters", "人物表"],
  ["propsMd", "props", "道具表"],
  ["locationsMd", "locations", "场景表"],
] as const;

function changedIndexes(input: RefreshSource): Set<number> {
  const available = new Set(input.pack.episodes.map(episode => episode.index));
  const changed = new Set(input.changedEpisodeIndexes);
  if (!changed.size || Array.from(changed).some(index => !Number.isInteger(index) || !available.has(index))) {
    throw new Error("资产更新缺少有效的改动集编号，原设定保留");
  }
  return changed;
}

/** 复用原文字入口，只生成资产表；正文、旧分镜和其他集均是只读上下文。 */
export function buildManhuaStoryAssetRefreshPrompt(input: RefreshSource): string {
  const changed = changedIndexes(input);
  return [
    "根据已接受的剧情改动更新道具、服装和场景设定。只输出完整人物表、道具表、场景表，不改写剧情，不输出任何集正文、分镜、秒位或视频提示词。",
    `本次允许更新的剧情来源：第${Array.from(changed).sort((a, b) => a - b).join("、")}集。其余集的资产、原有资产行和人物身份必须保留。`,
    "现有角色只更新剧情明确要求的服装、妆造、携带道具及状态；保留姓名、别名、性别、年龄、脸型五官和身份，不重新设计脸。没有事实依据的设定原样保留。新人物只有本次正文明确新增时才增加。",
    "各表保留全部旧行，按原姓名/别名对应同一资产，不因排序、改称呼而创建另一身份。新增项必须有可用完整规格，禁止待补、待定、TODO、占位符或空字段。",
    "仅使用以下三个二级标题和逐行格式：\n## 人物表\n- 姓名/别名｜年龄外形与服装｜动机｜关系｜性格底线\n## 道具表\n- 名称/别名｜功能｜外形材质\n## 场景表\n- 名称/别名｜氛围｜关键元素",
    "【旧资产表，只改受本次剧情影响的规格】",
    ...tableGroups.map(([field, , title]) => `## ${title}\n${input.pack[field]}`),
    "【已接受正文，只读，不得重写】",
    ...input.pack.episodes.map(episode => `第${episode.index}集「${episode.title}」${changed.has(episode.index) ? "（本次已改）" : "（保持原样）"}\n${episode.body}\n片尾钩子：${episode.endHook}`),
  ].join("\n\n");
}

function nameKey(name: string | undefined): string {
  return normalizeForManhuaNameMatch(name || "").replace(/\s+/g, "").toLowerCase();
}

function names(anchor: Pick<ManhuaWriterAssetAnchor, "nameZh" | "aliasZh">): Set<string> {
  return new Set([nameKey(anchor.nameZh), nameKey(anchor.aliasZh)].filter(Boolean));
}

function canonicalizeTable(md: string, previous: ManhuaWriterAssetAnchor[], title: string): string {
  const rows = stripMarkdownTableHeaderLines(md.split(/\n/).map(line => line.trim()).filter(Boolean));
  const consumed = new Set<string>();
  const normalizedRows = rows.map(line => {
    const parsed = parseWriterTableLine(line, { preserveFullSpecs: true });
    if (!parsed || !parsed.fields.length) throw new Error(`${title}存在空白或无法解析的资产行，原设定保留`);
    const rowNames = names(parsed);
    const matches = previous.filter(anchor => Array.from(names(anchor)).some(name => rowNames.has(name)));
    if (matches.length > 1) throw new Error(`${title}的姓名或别名对应多个旧资产，原设定保留`);
    const old = matches[0];
    if (old && consumed.has(old.id)) throw new Error(`${title}重复改写同一资产，原设定保留`);
    if (old) consumed.add(old.id);
    // 保留原字段全文；原行解析器用于身份匹配，不拿它的长度裁剪结果写回。
    const parts = line.replace(/^[-*•]\s*/, "").replace(/^\d+[\.\)、]\s*/, "").split(/[｜|]/).map(part => part.trim());
    while (parts[0] === "") parts.shift();
    while (parts[parts.length - 1] === "") parts.pop();
    if (parts.length < (title === "人物表" ? 5 : 3)) throw new Error(`${title}的设定字段不完整，原设定保留`);
    if (parts.slice(1).some(part => !part)) throw new Error(`${title}存在空规格，原设定保留`);
    const head = old ? `${old.nameZh}${old.aliasZh ? `/${old.aliasZh}` : ""}` : parts[0];
    return `- ${head}｜${parts.slice(1).join("｜")}`;
  });
  if (consumed.size !== previous.length) throw new Error(`${title}遗漏旧资产，不能删除其他集仍在使用的设定`);
  return normalizedRows.join("\n");
}

function visualSpec(anchor: ManhuaWriterAssetAnchor): string {
  return JSON.stringify({
    look: anchor.lookZh.trim(),
    motive: (anchor.motiveZh || "").trim(),
    note: (anchor.noteZh || "").trim(),
    states: anchor.statesZh || [],
  });
}

export type ManhuaStoryAssetRefresh = {
  tables: AssetTables;
  assetCanon: ManhuaWriterAssetCanon;
  addedAnchorIds: string[];
  changedAnchorIds: string[];
  /** 已有角色只重出服装全身图；调用者必须排除这些角色的脸特写节点。 */
  characterIds: string[];
};

/** 只返回三份表及增量计划，不返回或采用模型生成的 episodes。 */
export function parseManhuaStoryAssetRefresh(input: RefreshSource & {
  rawMarkdown: string;
  previousCanon?: ManhuaWriterAssetCanon;
}): ManhuaStoryAssetRefresh {
  const changed = changedIndexes(input);
  const raw = input.rawMarkdown.trim();
  if (/待补|待定|待完善|占位|\bTODO\b/i.test(raw)) throw new Error("资产设定仍有待补或占位内容，原设定保留");
  const headings = Array.from(raw.matchAll(/^##\s+(.+?)\s*$/gm)).map(match => match[1]);
  if (headings.length !== 3 || new Set(headings).size !== 3 || headings.some(heading => !["人物表", "道具表", "场景表"].includes(heading))) {
    throw new Error("资产更新必须只返回人物表、道具表、场景表，不能包含改写剧情");
  }
  const parsed = parseManhuaWriterPack(raw, input.pack.episodeCount);
  const previous = input.previousCanon || buildManhuaWriterAssetCanon({ ...input.pack, preserveFullSpecs: true });
  const tables = {} as AssetTables;
  for (const [field, group, title] of tableGroups) {
    if (!parsed[field].trim()) throw new Error(`${title}为空，原设定保留`);
    tables[field] = canonicalizeTable(parsed[field], previous[group], title);
  }
  const assetCanon = buildManhuaWriterAssetCanon({ ...tables, episodes: input.pack.episodes, preserveFullSpecs: true, previousCanon: previous });
  const addedAnchorIds: string[] = [];
  const changedAnchorIds: string[] = [];
  const characterIds: string[] = [];
  const sceneIdMap = new Map<string, string>();
  for (const [field, group, title] of tableGroups) {
    const rows = tables[field].split(/\n/).filter(Boolean);
    if (!assetCanon[group].length || assetCanon[group].length !== rows.length) {
      throw new Error(`${title}未被原资产编译器完整保留，原设定保留`);
    }
    const usedIds = new Set<string>();
    assetCanon[group] = assetCanon[group].map(anchor => {
      const old = previous[group].find(item => nameKey(item.nameZh) === nameKey(anchor.nameZh));
      const id = old?.id || anchor.id;
      if (usedIds.has(id)) throw new Error(`${title}重复资产身份，原设定保留`);
      usedIds.add(id);
      if (group === "locations") sceneIdMap.set(anchor.id, id);
      if (!old) addedAnchorIds.push(id);
      else if (visualSpec(old) !== visualSpec(anchor)) {
        changedAnchorIds.push(id);
        if (group === "characters") characterIds.push(id);
      }
      return { ...anchor, id };
    });
  }
  assetCanon.episodeMainSceneId = Object.fromEntries(Object.entries(assetCanon.episodeMainSceneId).map(([episode, id]) => [
    episode,
    !changed.has(Number(episode)) && previous.episodeMainSceneId[Number(episode)]
      ? previous.episodeMainSceneId[Number(episode)]
      : sceneIdMap.get(id) || id,
  ]));
  return { tables, assetCanon, addedAnchorIds, changedAnchorIds, characterIds };
}
