import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import {
  resolveManhuaAdvisorSelection,
  resolveManhuaAdvisorShotsFromBlocks,
} from "../components/ManhuaScriptWorkbench";
import { buildManhuaAdvisorProject } from "./manhuaAdvisorProject";
import { buildAdvisorQuestion } from "./manhuaCreativeAdvisorContext";
import {
  advisorRecentHistory,
  type AdvisorPendingRequest,
} from "./manhuaAdvisorSession";
import { MANHUA_ADVISOR_STAGE_LABELS } from "./manhuaAdvisorEntry";
import { formatManhuaAdvisorContextIssue } from "./manhuaAdvisorFeedback";
import {
  spawnManhuaDramaStudio,
  resolveShotsForEpisodeKeyarts,
} from "./canvasDramaStudio";
import { buildManhuaCreativeAdvisorLlmMessages } from "../../../server/services/platformSkillQa";

// 执行生产面板的发送函数；仅在真正提交请求的边界截获，不调用模型或账本。
const panel = readFileSync(
  new URL(
    "../components/canvas/ManhuaCreativeAdvisorPanel.tsx",
    import.meta.url
  ),
  "utf8"
);
const tree = ts.createSourceFile(
  "panel.tsx",
  panel,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let sendSource = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "send")
    sendSource = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
if (!sendSource) throw new Error("缺少生产顾问发送函数");
const sendJs = ts.transpileModule(`(${sendSource})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(hasOutput = true) {
  const text = [
    "| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |",
    "|---|---|---|---|---|---|",
    "| 1 | 0-5 | 全景固定 | 黑奇走到门前 | 阿菁：停下。 | 脚步声 |",
    "| 2 | 5-10 | 近景缓推 | 黑奇抬起受伤前腿 | 黑奇：我还能走。 | 呼吸声 |",
    "| 3 | 10-15 | 侧面跟移 | 阿菁扶住黑奇 | 阿菁：我扶你。 | 衣料声 |",
  ].join("\n");
  const blocks = spawnManhuaDramaStudio({
    topic: "墨菁传",
    episodeIndex: 1,
    videoModel: "seedance-2.0-mini",
  }).blocks.map(block => ({
    ...block,
    ...(block.id.startsWith("reverse-")
      ? { prompt: text, outputText: hasOutput ? text : "" }
      : {}),
  }));
  const advisorShots = resolveManhuaAdvisorShotsFromBlocks({
    beats: blocks.find(b => b.id.startsWith("beats-")),
    reverse: blocks.find(b => b.id.startsWith("reverse-")),
    story: blocks.find(b => b.id.startsWith("story-")),
  });
  const shot = advisorShots.find(s => s.index === 2);
  const selection = resolveManhuaAdvisorSelection({ episodeIndex: 1, shot });
  const project = buildManhuaAdvisorProject({
    pack: null,
    bible: null,
    episodeIndex: 1,
    phase: "storyboard",
    videoModel: "seedance-2.0-mini",
    writerConfirmed: false,
    refs: [],
    blocks,
    selection,
  });
  return { blocks, shot, project };
}

function send(project: ReturnType<typeof buildManhuaAdvisorProject>) {
  const submit = vi.fn(
    (_request: AdvisorPendingRequest, _confirmPaid: boolean) => undefined
  );
  const toast = { error: vi.fn() };
  const fn = runInNewContext(sendJs, {
    inFlight: { current: false },
    pendingPaid: null,
    unresolvedFailed: false,
    userId: "test-user",
    sessionStorageBlocked: false,
    project,
    turns: [],
    toast,
    stageZh: "分镜",
    selectedTemplate: null,
    templates: [],
    crypto: { randomUUID },
    setDraft: vi.fn(),
    submit,
    manhuaCreativeAdvisorContextSchema,
    advisorRecentHistory,
    formatManhuaAdvisorContextIssue,
    MANHUA_ADVISOR_STAGE_LABELS,
    buildAdvisorQuestion,
  });
  fn("检查当前选中镜头的动作与运镜");
  expect(toast.error).not.toHaveBeenCalled();
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![1]).toBe(false);
  return submit.mock.calls[0]![0];
}

describe("选中镜头到真实顾问请求", () => {
  it("六列原稿镜2的动作、运镜、对白经过项目投影和真实发送schema后仍一致", () => {
    const h = fixture();
    expect(h.shot).toEqual(
      resolveShotsForEpisodeKeyarts(h.blocks, 1).find(s => s.index === 2)
    );
    expect(h.shot).toBeDefined();
    const request = send(h.project);
    expect(request.label).toContain("镜 2");
    expect(request.manhuaContext?.shotSummary).toContain(
      JSON.stringify(h.shot)
    );
    expect(request.manhuaContext?.shotSummary).toContain("黑奇抬起受伤前腿");
    expect(request.manhuaContext?.shotSummary).toContain("近景缓推");
    expect(request.manhuaContext?.shotSummary).toContain("我还能走");
    expect(request.manhuaContext?.shotSummary).not.toContain("阿菁扶住黑奇");
    expect(
      manhuaCreativeAdvisorContextSchema.safeParse(request.manhuaContext)
        .success
    ).toBe(true);
    const messages = buildManhuaCreativeAdvisorLlmMessages({
      question: request.question,
      rawQuestion: request.rawQuestion,
      context: manhuaCreativeAdvisorContextSchema.parse(request.manhuaContext),
    });
    const userMessage = messages.find(
      message => message.role === "user"
    )!.content;
    expect(userMessage).toContain(JSON.stringify(h.shot));
    expect(userMessage).toContain("检查当前选中镜头的动作与运镜");
    expect(userMessage).not.toContain("阿菁扶住黑奇");
  });

  it("同一份六列表只有prompt未产出时，可以咨询缺项但请求不得冒充已有镜头", () => {
    const h = fixture(false);
    expect(h.shot).toBeUndefined();
    const request = send(h.project);
    expect(request.label).toContain("未指定镜头");
    expect(request.manhuaContext?.shotSummary).toContain(
      "没有可读取的已生成分镜"
    );
    expect(request.manhuaContext?.shotSummary).not.toContain(
      "黑奇抬起受伤前腿"
    );
    expect(request.manhuaContext?.shotSummary).not.toContain(
      "落实本镜人物站位"
    );
  });
});
