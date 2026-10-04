import { NOVEL_FACETS, novelScriptSchema } from "@shared/novelWorkspace";
import {
  buildManhuaWriterSession,
  serializeManhuaWriterSession,
  loadManhuaWriterSessionFromStorage,
  MANHUA_WRITER_SESSION_LS_KEY,
} from "@shared/manhuaWriterSession";
import { deriveWriterAssetTablesFromScript } from "@shared/manhuaWriterAssetCanon";
import {
  scopedManhuaStorage,
  parseManhuaProjectScope,
} from "@shared/manhuaProjectScope";
import {
  spliceManhuaWriterPackFromEpisode,
  type ManhuaWriterPack,
} from "@shared/manhuaWriterRoom";
import type { NovelRun } from "./novelWorkspace";

/** No model call: carry the exact selected script into a separate, editable factory project. */
export function novelRunToWriterPack(run: NovelRun): ManhuaWriterPack {
  if (run.input.stage !== "script" || run.result.stage !== "script")
    throw new Error("请选择已生成的剧本版本");
  const script = novelScriptSchema.parse(JSON.parse(run.result.text));
  if (
    script.episodes.length !== run.input.episodeCount ||
    script.episodes.some(
      (e, i) => e.index !== i + (run.input.episodeStart || 1)
    )
  )
    throw new Error("剧本分集不完整，未创建作品");
  const line = (value: string) => value.replace(/\s*\n\s*/g, " ");
  const episodes = script.episodes.map(ep => ({
    index: ep.index,
    title: ep.title,
    endHook: ep.hook,
    body: [
      `开场：${ep.opening}`,
      ...ep.scenes.map(scene =>
        [
          `### 场次 ${scene.key}`,
          ...NOVEL_FACETS.map(facet => `${facet}：\n${scene[facet]}`),
        ].join("\n\n")
      ),
      `本集兑现：${ep.payoff}`,
      // One original scene per editable production segment. No invented events or dialogue.
      "### 可拍段落表",
      ...ep.scenes.map((scene, index) =>
        [
          `#### 段${String(index + 1).padStart(2, "0")}`,
          `- 意图：${line(scene.氛围)}`,
          `- 对白：${line(scene.对白)}`,
          `- 表演：${line(scene.场景)} ${line(scene.人物)}`,
          `- 场景：${line(scene.场景)}`,
          `- 配色风格：${line(scene.灯光)} ${line(scene.氛围)}`,
          `- 角色：${line(scene.人物)}`,
          `- 服装道具：${line(scene.妆容)}`,
          `- 光影运镜：${line(scene.灯光)}`,
        ].join("\n")
      ),
    ].join("\n\n"),
  }));
  const tables = deriveWriterAssetTablesFromScript({
    episodes,
    charactersMd: "",
    propsMd: "",
    locationsMd: "",
  });
  const pack: ManhuaWriterPack = {
    seriesTitle: script.title,
    logline: run.input.direction,
    charactersMd: tables.charactersMd,
    propsMd: tables.propsMd,
    locationsMd: tables.locationsMd,
    episodes,
    episodeCount: episodes.length,
    rawMarkdown: "",
  };
  pack.rawMarkdown = [
    "## 系列标题",
    pack.seriesTitle,
    "## 一句话系列梗概",
    pack.logline,
    "## 人物表",
    pack.charactersMd,
    "## 道具表",
    pack.propsMd,
    "## 场景表",
    pack.locationsMd,
    ...episodes.map(
      ep =>
        `## 第${ep.index}集\n\n### 集标题\n${ep.title}\n\n### 本集剧情\n${ep.body}\n\n### 片尾钩子\n${ep.endHook}`
    ),
  ].join("\n\n");
  return pack;
}
export function createNovelFactoryProject(
  storage: Storage,
  userId: string,
  run: NovelRun,
  projectId = run.input.requestId
) {
  const search = `?project=${encodeURIComponent(projectId)}&owner=${encodeURIComponent(userId)}`;
  const scope = parseManhuaProjectScope(search)!;
  const target = scopedManhuaStorage(storage, scope);
  const originKey = "novel-origin-v1";
  const existing = target.getItem(originKey);
  if (existing) {
    const origin = JSON.parse(existing);
    const imports: { requestId: string; sha: string }[] = origin.imports || [
      {
        requestId: origin.run.input.requestId,
        sha: origin.run.result.resultSha256,
      },
    ];
    const previous = imports.find(v => v.requestId === run.input.requestId);
    if (previous) {
      if (previous.sha !== run.result.resultSha256)
        throw new Error("同一请求的剧本版本不一致，请保留现有作品");
      return { href: `/canvas${search}`, created: false };
    }
    const session = loadManhuaWriterSessionFromStorage(target),
      pack = novelRunToWriterPack(run);
    if (!session?.writerPack)
      throw new Error("作品记录不完整，请先恢复作品云备份");
    const old = session.writerPack;
    const last = old.episodes.at(-1)?.index || 0;
    if (pack.episodes[0]?.index !== last + 1)
      throw new Error(
        `此作品已保留至第${last}集，只能追加后续集数；改写版本请另建作品，不能覆盖已制作内容。`
      );
    const combined = spliceManhuaWriterPackFromEpisode(old, pack, last + 1);
    const merged = {
      ...old,
      charactersMd: combined.charactersMd,
      propsMd: combined.propsMd,
      locationsMd: combined.locationsMd,
      episodes: [...old.episodes, ...pack.episodes],
      episodeCount: old.episodes.length + pack.episodes.length,
      rawMarkdown:
        old.rawMarkdown +
        "\n\n" +
        pack.episodes
          .map(
            ep =>
              `## 第${ep.index}集\n\n### 集标题\n${ep.title}\n\n### 本集剧情\n${ep.body}\n\n### 片尾钩子\n${ep.endHook}`
          )
          .join("\n\n"),
    };
    // Keep all existing production state and edited episodes. New episodes return to outline review.
    const writer = buildManhuaWriterSession({
      ...session,
      writerPack: merged,
      episodeCount: merged.episodeCount,
      focusEpisode: last + 1,
      writerConfirmed: false,
      directorUnlocked: false,
      workflowPhase: "outline",
    });
    const changes = [
      [MANHUA_WRITER_SESSION_LS_KEY, serializeManhuaWriterSession(writer)],
      ["mv-manhua-cloud-draft-local-at-v1", new Date().toISOString()],
      [
        originKey,
        JSON.stringify({
          ...origin,
          imports: [
            ...imports,
            { requestId: run.input.requestId, sha: run.result.resultSha256 },
          ],
        }),
      ],
    ];
    const before = changes.map(([key]) => [key, target.getItem(key)]);
    try {
      for (const [key, value] of changes) {
        target.setItem(key, value);
        if (target.getItem(key) !== value) throw new Error("续集保存校验失败");
      }
    } catch (error) {
      for (const [key, value] of before)
        if (value !== null) target.setItem(key!, value);
        else target.removeItem(key!);
      throw error;
    }
    return { href: `/canvas${search}`, created: false };
  }
  if ((run.input.episodeStart || 1) !== 1)
    throw new Error("请先采用本季前面的剧本，再将续集接入同一作品");
  if (target.length)
    throw new Error("此作品已有未完成的创建记录，未覆盖现有内容");
  const pack = novelRunToWriterPack(run);
  const writer = buildManhuaWriterSession({
    topic: pack.seriesTitle,
    brief: run.input.direction,
    writerPack: pack,
    episodeCount: pack.episodeCount,
    focusEpisode: 1,
    writerConfirmed: false,
    directorUnlocked: false,
    workflowPhase: "outline",
    manhuaUiMode: "workbench",
  });
  const entries = [
    [MANHUA_WRITER_SESSION_LS_KEY, serializeManhuaWriterSession(writer)],
    ["mv-freeform-canvas-v1", JSON.stringify({ blocks: [], edges: [] })],
    ["mv-manhua-cloud-draft-local-at-v1", new Date().toISOString()],
    [
      originKey,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        title: pack.seriesTitle,
        imports: [
          { requestId: run.input.requestId, sha: run.result.resultSha256 },
        ],
      }),
    ],
  ];
  const written: string[] = [];
  try {
    for (const [key, value] of entries) {
      target.setItem(key, value);
      written.push(key);
      if (target.getItem(key) !== value) throw new Error("作品保存校验失败");
    }
  } catch (error) {
    for (const key of written) target.removeItem(key);
    throw error;
  }
  return { href: `/canvas${search}`, created: true };
}

export function listLocalManhuaProjects(storage: Storage, userId: string) {
  const prefix = `mv-manhua-project:${userId}:`;
  const projects = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (
      !key?.startsWith(prefix) ||
      !key.endsWith(":" + MANHUA_WRITER_SESSION_LS_KEY)
    )
      continue;
    const projectId = key.slice(
      prefix.length,
      -(MANHUA_WRITER_SESSION_LS_KEY.length + 1)
    );
    try {
      parseManhuaProjectScope(`?project=${projectId}&owner=${userId}`);
      const session = JSON.parse(storage.getItem(key)!);
      const scoped = scopedManhuaStorage(storage, {
        projectId,
        ownerId: userId,
      });
      projects.push({
        projectId,
        title: session.writerPack?.seriesTitle || session.topic || "新作品",
        episodeCount: session.episodeCount,
        phase: session.workflowPhase,
        updatedAt: scoped.getItem("mv-manhua-cloud-draft-local-at-v1") || "",
      });
    } catch {
      /* A damaged item is not rewritten by listing. */
    }
  }
  return projects;
}
export function createEmptyManhuaProject(
  storage: Storage,
  userId: string,
  title: string
) {
  if (!title.trim()) throw new Error("请填写作品名称");
  const projectId = crypto.randomUUID();
  const scope = parseManhuaProjectScope(
    `?project=${projectId}&owner=${userId}`
  )!;
  const target = scopedManhuaStorage(storage, scope);
  const writer = serializeManhuaWriterSession(
    buildManhuaWriterSession({
      topic: title.trim(),
      episodeCount: 3,
      writerPack: null,
      workflowPhase: "outline",
    })
  );
  target.setItem(MANHUA_WRITER_SESSION_LS_KEY, writer);
  if (target.getItem(MANHUA_WRITER_SESSION_LS_KEY) !== writer)
    throw new Error("作品保存失败");
  return `/canvas?project=${projectId}&owner=${userId}`;
}
