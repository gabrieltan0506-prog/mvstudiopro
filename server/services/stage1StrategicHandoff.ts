/**
 * Stage 1 戰略看板 → Stage 2 專屬文案：結構化「手遞」（截斷與輕量去噪，不含二次 LLM）。
 * 將標題、文案、分鏡類欄位（detailedScript / graphicPlan / videoPlan）壓縮後併入 buildPlatformContent 的 user JSON。
 */

function clip(s: unknown, max: number): string {
  if (s == null) return "";
  const t = String(s)
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function firstStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return "";
}

export type Stage1StrategicHandoffV1 = {
  version: 1;
  headline: string;
  subheadline: string;
  personaSummary: string;
  topSignalsBrief: string[];
  hotTopicAnchors: { title: string; whyHot: string; howToUse: string }[];
  platformMenuDigest: Array<Record<string, string>>;
  actionCardSteps: { title: string; detail: string }[];
  /** 選題種子：優先看板 contentBlueprints，否則用快照 titleExecutions 等補齊 */
  contentSeeds: Array<Record<string, unknown>>;
  monetizationPreview: Array<Record<string, string>>;
  /** 說明種子來源，便於除錯 */
  sourceNote: string;
};

export function buildStage1StrategicHandoffForStage2(
  strategicDashboard: unknown,
  snapshotSummary: Record<string, unknown> | null | undefined,
): Stage1StrategicHandoffV1 | null {
  if (!strategicDashboard || typeof strategicDashboard !== "object") return null;
  const d = strategicDashboard as Record<string, unknown>;

  const headline = clip(d.headline, 400);
  const subheadline = clip(d.subheadline, 600);
  const personaSummary = clip(d.personaSummary, 1200);

  const topSignalsBrief: string[] = [];
  const rawSignals = Array.isArray(d.topSignals) ? d.topSignals : [];
  for (const s of rawSignals.slice(0, 8)) {
    if (typeof s === "string") {
      const c = clip(s, 320);
      if (c) topSignalsBrief.push(c);
    } else if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      const title = clip(o.title ?? o.label, 120);
      const detail = clip(o.detail ?? o.summary ?? o.body, 400);
      const line = [title, detail].filter(Boolean).join(" — ");
      if (line) topSignalsBrief.push(line);
    }
  }

  const hotTopicAnchors: Stage1StrategicHandoffV1["hotTopicAnchors"] = [];
  const rawHot = Array.isArray(d.hotTopics) ? d.hotTopics : [];
  for (const h of rawHot.slice(0, 12)) {
    if (typeof h === "string") {
      const t = clip(h, 240);
      if (t) hotTopicAnchors.push({ title: t, whyHot: "", howToUse: "" });
    } else if (h && typeof h === "object") {
      const o = h as Record<string, unknown>;
      hotTopicAnchors.push({
        title: clip(o.title ?? o.headline, 200),
        whyHot: clip(o.whyHot ?? o.rationale, 400),
        howToUse: clip(o.howToUse ?? o.executionHint, 500),
      });
    }
  }

  const platformMenuDigest: Array<Record<string, string>> = [];
  const rawMenu = Array.isArray(d.platformMenu) ? d.platformMenu : [];
  for (const m of rawMenu.slice(0, 8)) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    platformMenuDigest.push({
      platform: clip(o.platform, 40),
      label: clip(o.label ?? o.displayName, 80),
      lane: clip(o.lane ?? o.nextMove, 300),
      titleExample: clip(o.titleExample, 200),
      contentHook: clip(o.contentHook, 500),
      whyNow: clip(o.whyNow, 400),
    });
  }

  const actionCardSteps: Stage1StrategicHandoffV1["actionCardSteps"] = [];
  const rawActions = Array.isArray(d.actionCards) ? d.actionCards : [];
  for (const a of rawActions.slice(0, 8)) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    actionCardSteps.push({
      title: clip(o.title, 160),
      detail: clip(o.detail ?? o.action, 600),
    });
  }

  const monetizationPreview: Array<Record<string, string>> = [];
  const rawLanes = Array.isArray(d.monetizationLanes) ? d.monetizationLanes : [];
  for (const m of rawLanes.slice(0, 4)) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    monetizationPreview.push({
      title: clip(o.title, 120),
      fitReason: clip(o.fitReason, 400),
      offerShape: clip(o.offerShape, 300),
      firstValidation: clip(o.firstValidation, 400),
    });
  }

  const contentSeeds: Array<Record<string, unknown>> = [];
  let sourceNote = "";

  const rawBp = Array.isArray(d.contentBlueprints) ? d.contentBlueprints : [];
  if (rawBp.length > 0) {
    sourceNote = "dashboard_contentBlueprints";
    for (const bp of rawBp.slice(0, 6)) {
      if (!bp || typeof bp !== "object") continue;
      const o = bp as Record<string, unknown>;
      const stepsRaw = Array.isArray(o.actionableSteps) ? o.actionableSteps : [];
      contentSeeds.push({
        source: "stage1_dashboard_blueprint",
        title: clip(o.title, 200),
        format: clip(o.format ?? o.presentationMode, 40),
        hook: clip(o.hook ?? o.openingHook, 800),
        copywriting: clip(o.copywriting, 3500),
        detailedScript: clip(firstStr(o, ["detailedScript", "detailed_script"]), 8000),
        graphicPlan: clip(o.graphicPlan ?? o.graphic_plan, 6000),
        videoPlan: clip(o.videoPlan ?? o.video_plan, 6000),
        suitablePlatforms: Array.isArray(o.suitablePlatforms)
          ? o.suitablePlatforms.map((x) => String(x)).slice(0, 8)
          : [],
        actionableStepsPreview: stepsRaw.slice(0, 4).map((x) =>
          typeof x === "string" ? clip(x, 300) : clip(JSON.stringify(x), 300),
        ),
      });
    }
  }

  const snapTe =
    snapshotSummary && Array.isArray(snapshotSummary.titleExecutions) ? snapshotSummary.titleExecutions : [];

  if (contentSeeds.length === 0 && snapTe.length > 0) {
    sourceNote = sourceNote ? `${sourceNote}+snapshot_titleExecutions` : "snapshot_titleExecutions";
    for (const te of snapTe.slice(0, 6)) {
      if (!te || typeof te !== "object") continue;
      const o = te as Record<string, unknown>;
      contentSeeds.push({
        source: "snapshot_title_execution",
        title: clip(o.title, 200),
        format: clip(o.presentationMode ?? o.format, 40),
        hook: clip(o.openingHook ?? o.hook, 800),
        copywriting: clip(o.copywriting, 3500),
        graphicPlan: clip(o.graphicPlan, 6000),
        videoPlan: clip(o.videoPlan, 6000),
        reason: clip(o.reason, 400),
        suitablePlatforms: Array.isArray(o.suitablePlatforms)
          ? o.suitablePlatforms.map((x) => String(x)).slice(0, 8)
          : [],
      });
    }
  }

  if (rawBp.length > 0 && snapTe.length > 0 && contentSeeds.length < 4) {
    const titles = new Set(contentSeeds.map((c) => String(c.title || "").trim().toLowerCase()).filter(Boolean));
    for (const te of snapTe) {
      if (contentSeeds.length >= 6) break;
      if (!te || typeof te !== "object") continue;
      const o = te as Record<string, unknown>;
      const tKey = String(o.title || "").trim().toLowerCase();
      if (tKey && titles.has(tKey)) continue;
      if (tKey) titles.add(tKey);
      contentSeeds.push({
        source: "snapshot_title_execution_supplement",
        title: clip(o.title, 200),
        format: clip(o.presentationMode ?? o.format, 40),
        hook: clip(o.openingHook ?? o.hook, 800),
        copywriting: clip(o.copywriting, 3500),
        graphicPlan: clip(o.graphicPlan, 6000),
        videoPlan: clip(o.videoPlan, 6000),
        reason: clip(o.reason, 400),
        suitablePlatforms: Array.isArray(o.suitablePlatforms)
          ? o.suitablePlatforms.map((x) => String(x)).slice(0, 8)
          : [],
      });
      sourceNote = `${sourceNote || "dashboard"}+snapshot_supplement`;
    }
  }

  return {
    version: 1,
    headline,
    subheadline,
    personaSummary,
    topSignalsBrief,
    hotTopicAnchors,
    platformMenuDigest,
    actionCardSteps,
    contentSeeds,
    monetizationPreview,
    sourceNote: sourceNote || "minimal",
  };
}
