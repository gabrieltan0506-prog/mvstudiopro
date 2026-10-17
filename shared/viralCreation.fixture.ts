/** 仅测试使用的虚构稿件，无真实账号或模型回执。 */
export function fictionalViralBlueprint(format: "图文" | "短视频" = "图文") {
  const paragraphs = ["开会突然被点名时，先复述问题确认自己理解。", "担心说错并不说明能力不足，先区分事实与推测。", "先说结论再举一个具体例子，最后说明需要的支持。", "下次会议前用一张便签写下关键结论和事实。"];
  return {
    title: "开会被点名，先把这句话说清楚", hook: "突然被问到时先复述问题", format,
    copywriting: paragraphs.join("\n"), detailedScript: paragraphs.join("\n"),
    executionDetails: { environmentAndWardrobe: "同一年轻职员在会议室桌前，穿浅蓝色衬衣。", lightingAndCamera: "窗侧自然光，中景固定拍摄。", stepByStepScript: paragraphs },
    graphicNotePages: format === "图文" ? paragraphs.map((body, i) => ({ pageIndex: i + 1, role: i === 0 ? "cover" : i === 3 ? "cta" : "detail_card", headline: `会议表达第${i + 1}步`, body })) : [],
    storyboardCells: format === "短视频" ? paragraphs.map((dialogueZh, i) => ({ cellIndex: i + 1, dialogueZh, sceneZh: "同一会议室桌前", shotSize: "中景", actionZh: "手势：右手指向便签，说完收回桌边；视线：由便签转向同事", cameraMoveZh: "固定", editNoteZh: "语气：先迟疑后笃定；重音：本句关键事实；停顿：句末停半拍" })) : [],
    methodApplications: [{ methodId: "audience-scene", quote: paragraphs[0], application: "用会议点名的具体场景切入沟通问题" }],
    xhsPackage: {
      structure: { templateId: "problem", steps: ["现状与场景", "原因与边界", "可执行方案", "落实行动"].map((name, i) => ({ name, quote: paragraphs[i] })) },
      audience: "刚入职的年轻职员", scene: "会议突然被点名", problem: "不知如何说清结论",
      titleOptions: ["开会被点名，先把这句话说清楚", "会议发言卡住时，先确认这个问题", "别急着讲细节：会议结论这样说", "明天开会前，准备一张事实便签"].map(title => ({ title, angle: "从会议沟通的真实场景给出可执行动作" })),
      cover: { headline: "被点名怎么接话", subline: "先确认问题", visual: "同一名浅蓝衬衣年轻职员坐在会议桌前，拿起便签确认同事的问题，背景有模糊白板。", layout: "人物在右侧，标题放左上方，保留清楚留白。", continuity: "后续页沿用同一职员、浅蓝衬衣、便签与会议室色调。" },
      conversion: { goal: "follow" as const, action: "下一篇继续拆解如何用事实支持结论", offer: "未设商品", delivery: "下一期的会议表达实例" },
      promiseDelivery: [{ promise: "被点名时有一句可用的话", section: "copywriting" as const, quote: paragraphs[0] }], evidenceRefs: ["creator"],
      experiment: { hypothesis: "场景更具体的标题可能让目标读者更容易理解", variable: "标题" as const, primaryMetric: "打开率", observation: "分别记录发布24小时和7天的同来源曝光与打开，缺分母不计算。" },
    },
  };
}
