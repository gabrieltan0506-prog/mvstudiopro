/**
 * 落点与相机绑定交叉校验（决定四 + 决定六）。
 *
 * 逐条对着决定四原话验：
 *   落点不能只弱引用放行；核 landingId 存在 / 所属镜头与版本 / 绑定 actor /
 *   坐标空间 / 落地表面；移动或删除落点使依赖确认失效；
 *   草稿给 issue，准备与执行硬拦；不跨镜只凭裸字符串找点。
 * 决定六：相机只绑不复制；覆盖范围、镜长、采样 FPS、时间映射都要能验；
 *   overlay.cameraPath 只有点没有秒数，不许当成已带时间的轨迹。
 *
 * **只验数据合同，不验渲染**。
 */
import { describe, expect, it } from "vitest";
import {
  sealManhuaActionPlan,
  validateManhuaActionPlan,
  type ManhuaActionPlan,
  type ManhuaPlanShot,
} from "./manhuaActionPlan";
import {
  areManhuaPlanBindingReferencesStillValid,
  hasBlockingManhuaBindingIssues,
  validateManhuaActionPlanBindings,
  type ManhuaActionPlanBindingContext,
  type ManhuaBindingIssueCode,
  type ManhuaResolvedLanding,
} from "./manhuaActionPlanBindings";

const MAN = "ap_actor_man";
const A = "ap_actor_ambush_a";

const OVERLAY_REF = { episodeIndex: 1, segmentIndex: 1, shotIndex: 2 };
const LANDING_ID = "lp_deck_port";
const LANDING_REV = "overlay-1a2b3c4d";
const CAM_REF = "shot_ir_e01_s01_2";
const CAM_REV = "ir-9f8e7d";
const SURFACE_REF = "surf_deck_main";

const world = (x: number, y: number, z: number) => ({
  space: "world" as const,
  x,
  y,
  z,
  unit: "m" as const,
  axis: "z_up" as const,
});

/** 一镜：伏兵甲登船，绑甲板落点；相机绑 shot_ir，已解析成带时间采样 */
function buildShot(over: Partial<ManhuaPlanShot> = {}): ManhuaPlanShot {
  return {
    shotId: "ap_shot_1",
    displayIndex: 1,
    sourceBinding: { episodeIndex: 1, segmentIndex: 1, sourceShotIndex: 2 },
    timeMap: { sourceDurationSec: 6, spans: [] },
    confirm: "confirmed",
    actorChanges: [],
    events: [
      {
        eventId: "ap_evt_land",
        kind: "land",
        actorId: A,
        phases: [{ kind: "contact", sourceStartSec: 1, sourceEndSec: 1.4 }],
        landing: {
          overlayRef: OVERLAY_REF,
          landingId: LANDING_ID,
          sourceRevision: LANDING_REV,
          surfaceRef: SURFACE_REF,
          surfaceZh: "甲板",
        },
        outcome: "landed",
        slowMotionIntent: false,
      },
    ],
    camera: {
      source: "shot_ir",
      sourceShotRef: CAM_REF,
      sourceRevision: CAM_REV,
      timeBasis: "source",
      timedSamplesResolved: true,
    },
    ...over,
  } as ManhuaPlanShot;
}

function buildPlan(shot: ManhuaPlanShot = buildShot()): ManhuaActionPlan {
  return sealManhuaActionPlan({
    format: "mv-manhua-action-plan-v1",
    actionPlanId: "ap_bindings_1",
    episodeIndex: 1,
    actors: [
      { actorId: MAN, nameZh: "男" },
      { actorId: A, nameZh: "伏兵甲" },
    ],
    initialStates: {
      [MAN]: { presence: "onstage", at: world(0, 0, 0), facing: { basis: "screen_deg", deg: 0 } },
      [A]: { presence: "not_entered" },
    },
    shots: [shot],
    executionRanges: [],
  } as never);
}

const baseLanding = (over: Partial<ManhuaResolvedLanding> = {}): ManhuaResolvedLanding => ({
  landingId: LANDING_ID,
  overlayRef: OVERLAY_REF,
  sourceRevision: LANDING_REV,
  point: world(2.5, 0, 1.2),
  boundActorId: A,
  surfaceRef: SURFACE_REF,
  surfaceZh: "甲板",
  ...over,
});

const baseContext = (
  over: Partial<ManhuaActionPlanBindingContext> = {},
): ManhuaActionPlanBindingContext => ({
  landings: [baseLanding()],
  cameras: [
    {
      source: "shot_ir",
      sourceShotRef: CAM_REF,
      sourceRevision: CAM_REV,
      coverage: { startSec: 0, endSec: 6 },
      coverageBasis: "source",
      sampling: { kind: "discrete" as const, fps: 24 },
      timedSamplesAvailable: true,
    },
  ],
  ...over,
});

const codes = (issues: { code: ManhuaBindingIssueCode }[]) => issues.map((i) => i.code);

describe("落点交叉校验（决定四）", () => {
  it("全部对得上：草稿与执行都无问题", () => {
    const plan = buildPlan();
    expect(validateManhuaActionPlanBindings(plan, baseContext(), "draft")).toEqual([]);
    expect(validateManhuaActionPlanBindings(plan, baseContext(), "execution")).toEqual([]);
  });

  it("落点被删除：草稿期也是 error，不是「还没填」", () => {
    const plan = buildPlan();
    const issues = validateManhuaActionPlanBindings(
      plan,
      baseContext({ landings: [] }),
      "draft",
    );
    expect(codes(issues)).toContain("landing_not_found");
    expect(issues.find((i) => i.code === "landing_not_found")?.severity).toBe("error");
    expect(hasBlockingManhuaBindingIssues(issues)).toBe(true);
  });

  it("落点被移动（版本变了）：依赖它的确认失效", () => {
    const plan = buildPlan();
    const ctx = baseContext({ landings: [baseLanding({ sourceRevision: "overlay-changed" })] });
    const issues = validateManhuaActionPlanBindings(plan, ctx, "draft");
    expect(codes(issues)).toContain("landing_revision_mismatch");
    expect(areManhuaPlanBindingReferencesStillValid(plan, ctx)).toBe(false);
    // 对照：没动过就仍然有效
    expect(areManhuaPlanBindingReferencesStillValid(plan, baseContext())).toBe(true);
  });

  it("落点现在属于另一镜：不许按裸 id 跨镜认领", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      landings: [baseLanding({ overlayRef: { episodeIndex: 1, segmentIndex: 1, shotIndex: 7 } })],
    });
    const issues = validateManhuaActionPlanBindings(plan, ctx, "draft");
    expect(codes(issues)).toContain("landing_overlay_mismatch");
    expect(issues.find((i) => i.code === "landing_overlay_mismatch")?.messageZh).toMatch(/第7镜/);
  });

  it("落点绑的是另一个角色：报出两边是谁", () => {
    const plan = buildPlan();
    const ctx = baseContext({ landings: [baseLanding({ boundActorId: MAN })] });
    const issues = validateManhuaActionPlanBindings(plan, ctx, "draft");
    const hit = issues.find((i) => i.code === "landing_actor_mismatch");
    expect(hit).toBeTruthy();
    expect(hit?.messageZh).toContain(MAN);
    expect(hit?.messageZh).toContain(A);
  });

  it("坐标空间未解析：草稿只提示，执行硬拦", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      landings: [baseLanding({ point: { space: "unresolved", reasonZh: "只有屏幕点，缺深度依据" } as never })],
    });
    const draft = validateManhuaActionPlanBindings(plan, ctx, "draft");
    const exec = validateManhuaActionPlanBindings(plan, ctx, "execution");
    expect(draft.find((i) => i.code === "landing_space_unresolved")?.severity).toBe("warning");
    expect(exec.find((i) => i.code === "landing_space_unresolved")?.severity).toBe("error");
    expect(hasBlockingManhuaBindingIssues(draft)).toBe(false);
    expect(hasBlockingManhuaBindingIssues(exec)).toBe(true);
  });

  it("登船缺表面稳定引用：草稿提示、执行硬拦，并报出缺哪一侧", () => {
    const shot = buildShot();
    (shot.events[0] as { landing: { surfaceRef?: string } }).landing.surfaceRef = undefined;
    const plan = buildPlan(shot);
    const draft = validateManhuaActionPlanBindings(plan, baseContext(), "draft");
    const exec = validateManhuaActionPlanBindings(plan, baseContext(), "execution");
    expect(draft.find((i) => i.code === "landing_surface_ref_missing")?.severity).toBe("warning");
    const hit = exec.find((i) => i.code === "landing_surface_ref_missing");
    expect(hit?.severity).toBe("error");
    expect(hit?.messageZh).toMatch(/计划侧/);
  });
});

describe("相机绑定交叉校验（决定六）", () => {
  it("相机来源不存在：error", () => {
    const plan = buildPlan();
    const issues = validateManhuaActionPlanBindings(plan, baseContext({ cameras: [] }), "draft");
    expect(codes(issues)).toContain("camera_source_not_found");
  });

  it("相机来源被改过：error", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      cameras: [
        {
          source: "shot_ir",
          sourceShotRef: CAM_REF,
          sourceRevision: "ir-changed",
          coverage: { startSec: 0, endSec: 6 },
          coverageBasis: "source",
          sampling: { kind: "discrete" as const, fps: 24 },
          timedSamplesAvailable: true,
        },
      ],
    });
    expect(codes(validateManhuaActionPlanBindings(plan, ctx, "draft"))).toContain(
      "camera_revision_mismatch",
    );
  });

  it("overlay.cameraPath 只有点没有秒数：声称已解析＝任何模式都 error", () => {
    // 决定六原话：不能把只有 points 的 overlay 当已带时间的轨迹。
    const shot = buildShot({
      camera: {
        source: "overlay_camera_path",
        sourceShotRef: "ov_e01_s01_2",
        sourceRevision: "ov-1",
        timeBasis: "source",
        timedSamplesResolved: true, // 谎称已解析
      },
    });
    const plan = buildPlan(shot);
    const ctx = baseContext({
      cameras: [
        {
          source: "overlay_camera_path",
          sourceShotRef: "ov_e01_s01_2",
          sourceRevision: "ov-1",
          timedSamplesAvailable: false, // 适配器如实报：给不出秒数
        },
      ],
    });
    const draft = validateManhuaActionPlanBindings(plan, ctx, "draft");
    const hit = draft.find((i) => i.code === "camera_timed_samples_overclaimed");
    expect(hit?.severity).toBe("error");
    // 假称已锁机位在草稿期也不能放行
    expect(hasBlockingManhuaBindingIssues(draft)).toBe(true);
    expect(areManhuaPlanBindingReferencesStillValid(plan, ctx)).toBe(false);
  });

  it("尚未解析成带时间采样：草稿留待确认，执行硬拦", () => {
    const shot = buildShot({
      camera: {
        source: "overlay_camera_path",
        sourceShotRef: "ov_e01_s01_2",
        sourceRevision: "ov-1",
        timeBasis: "source",
        timedSamplesResolved: false, // 如实说还没解析
      },
    });
    const plan = buildPlan(shot);
    const ctx = baseContext({
      cameras: [
        {
          source: "overlay_camera_path",
          sourceShotRef: "ov_e01_s01_2",
          sourceRevision: "ov-1",
          timedSamplesAvailable: false,
        },
      ],
    });
    expect(validateManhuaActionPlanBindings(plan, ctx, "draft").find(
      (i) => i.code === "camera_timed_samples_pending",
    )?.severity).toBe("warning");
    expect(validateManhuaActionPlanBindings(plan, ctx, "execution").find(
      (i) => i.code === "camera_timed_samples_pending",
    )?.severity).toBe("error");
    // 如实说没解析不算「引用失效」，确认本身还在
    expect(areManhuaPlanBindingReferencesStillValid(plan, ctx)).toBe(true);
  });

  it("覆盖范围盖不住镜长：报出差多少", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      cameras: [
        {
          source: "shot_ir",
          sourceShotRef: CAM_REF,
          sourceRevision: CAM_REV,
          coverage: { startSec: 0, endSec: 4 }, // 镜长 6s
          coverageBasis: "source",
          sampling: { kind: "discrete" as const, fps: 24 },
          timedSamplesAvailable: true,
        },
      ],
    });
    const hit = validateManhuaActionPlanBindings(plan, ctx, "execution").find(
      (i) => i.code === "camera_coverage_gap",
    );
    expect(hit?.severity).toBe("error");
    expect(hit?.messageZh).toMatch(/0–4s/);
    expect(hit?.messageZh).toMatch(/6\.000s/);
  });

  it("整镜慢动作：按呈现时间绑定时，需要盖住的是呈现时长", () => {
    // 6 秒源、全程 0.5 倍 → 呈现 12 秒
    const shot = buildShot({
      timeMap: { sourceDurationSec: 6, spans: [{ sourceStartSec: 0, sourceEndSec: 6, rate: 0.5 }] },
      camera: {
        source: "shot_ir",
        sourceShotRef: CAM_REF,
        sourceRevision: CAM_REV,
        timeBasis: "presentation",
        timedSamplesResolved: true,
      },
    });
    const plan = buildPlan(shot);
    const short = baseContext({
      cameras: [
        {
          source: "shot_ir",
          sourceShotRef: CAM_REF,
          sourceRevision: CAM_REV,
          coverage: { startSec: 0, endSec: 6 }, // 只盖住源时长，不够呈现时长
          coverageBasis: "presentation",
          sampling: { kind: "discrete" as const, fps: 24 },
          timedSamplesAvailable: true,
        },
      ],
    });
    expect(codes(validateManhuaActionPlanBindings(plan, short, "execution"))).toContain(
      "camera_coverage_gap",
    );
    const enough = baseContext({
      cameras: [
        {
          source: "shot_ir",
          sourceShotRef: CAM_REF,
          sourceRevision: CAM_REV,
          coverage: { startSec: 0, endSec: 12 },
          coverageBasis: "presentation",
          sampling: { kind: "discrete" as const, fps: 24 },
          timedSamplesAvailable: true,
        },
      ],
    });
    expect(codes(validateManhuaActionPlanBindings(plan, enough, "execution"))).not.toContain(
      "camera_coverage_gap",
    );
  });

  it("覆盖与绑定不在同一条时间轴：不换算、如实说无法断言", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      cameras: [
        {
          source: "shot_ir",
          sourceShotRef: CAM_REF,
          sourceRevision: CAM_REV,
          coverage: { startSec: 0, endSec: 99 }, // 长度够，但基准不同
          coverageBasis: "presentation",
          sampling: { kind: "discrete" as const, fps: 24 },
          timedSamplesAvailable: true,
        },
      ],
    });
    const hit = validateManhuaActionPlanBindings(plan, ctx, "draft").find(
      (i) => i.code === "camera_coverage_gap",
    );
    expect(hit?.messageZh).toMatch(/不是同一条时间轴/);
  });

  it("采样帧率低于时间映射基准：变速会丢帧", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      cameras: [
        {
          source: "shot_ir",
          sourceShotRef: CAM_REF,
          sourceRevision: CAM_REV,
          coverage: { startSec: 0, endSec: 6 },
          coverageBasis: "source",
          sampling: { kind: "discrete" as const, fps: 12 },
          timedSamplesAvailable: true,
        },
      ],
    });
    expect(codes(validateManhuaActionPlanBindings(plan, ctx, "execution"))).toContain(
      "camera_sampling_fps_low",
    );
  });
});

describe("边界：不该报的不要报", () => {
  it("没有落点绑定的事件（如观察）不产生落点问题", () => {
    const shot = buildShot({
      events: [
        {
          eventId: "ap_evt_look",
          kind: "observe",
          actorId: MAN,
          phases: [{ kind: "recover", sourceStartSec: 0, sourceEndSec: 1 }],
          subjectActorId: A,
          outcome: "observed",
          slowMotionIntent: false,
        },
      ] as never,
    });
    const issues = validateManhuaActionPlanBindings(buildPlan(shot), baseContext(), "execution");
    expect(codes(issues).filter((c) => c.startsWith("landing_"))).toEqual([]);
  });

  it("镜头没绑相机：不产生相机问题", () => {
    const shot = buildShot({ camera: undefined });
    const issues = validateManhuaActionPlanBindings(buildPlan(shot), baseContext(), "execution");
    expect(codes(issues).filter((c) => c.startsWith("camera_"))).toEqual([]);
  });
});

/**
 * 0915 复审补测：三条「没证据也放行」的反例，外加复合键歧义与镜头归属。
 * 每条都断言**具体 issue code**，不接受「抛了某个错」就算过。
 */
describe("复审补测：没证据不许放行", () => {
  const screen = (x: number, y: number) => ({ space: "screen" as const, x, y });

  it("P1 二维落点：登船执行必须要世界坐标，screen 不放行", () => {
    const plan = buildPlan();
    const ctx = baseContext({ landings: [baseLanding({ point: screen(0.5, 0.5) })] });
    const draft = validateManhuaActionPlanBindings(plan, ctx, "draft");
    const exec = validateManhuaActionPlanBindings(plan, ctx, "execution");
    expect(draft.find((i) => i.code === "landing_world_point_required")?.severity).toBe("warning");
    const hit = exec.find((i) => i.code === "landing_world_point_required");
    expect(hit?.severity).toBe("error");
    expect(hit?.messageZh).toMatch(/二维点无深度/);
    expect(hasBlockingManhuaBindingIssues(exec)).toBe(true);
  });

  it("P1 二维落点：出水同样要世界坐标", () => {
    const shot = buildShot({
      events: [
        {
          eventId: "ap_evt_emerge",
          kind: "emerge",
          actorId: A,
          phases: [{ kind: "burst", sourceStartSec: 0, sourceEndSec: 1 }],
          landing: {
            overlayRef: OVERLAY_REF,
            landingId: LANDING_ID,
            sourceRevision: LANDING_REV,
          },
          outcome: "emerged",
          slowMotionIntent: false,
        },
      ] as never,
    });
    const ctx = baseContext({ landings: [baseLanding({ point: screen(0.4, 0.6) })] });
    expect(
      codes(validateManhuaActionPlanBindings(buildPlan(shot), ctx, "execution")),
    ).toContain("landing_world_point_required");
  });

  it("P1 相机缺证据：只有两个 true 不算已解析", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      cameras: [
        {
          source: "shot_ir",
          sourceShotRef: CAM_REF,
          sourceRevision: CAM_REV,
          // 没有 coverage / coverageBasis / sampling
          timedSamplesAvailable: true,
        },
      ],
    });
    const exec = validateManhuaActionPlanBindings(plan, ctx, "execution");
    const hit = exec.find((i) => i.code === "camera_evidence_missing");
    expect(hit?.severity).toBe("error");
    expect(hit?.messageZh).toMatch(/覆盖范围/);
    expect(hit?.messageZh).toMatch(/覆盖时间基准/);
    expect(hit?.messageZh).toMatch(/采样能力/);
    expect(hasBlockingManhuaBindingIssues(exec)).toBe(true);
  });

  it("P1 覆盖基准不再回退到绑定自己的声明", () => {
    // 只给 coverage、不给 coverageBasis：过去会拿 cam.timeBasis 顶上，等于自证
    const plan = buildPlan();
    const ctx = baseContext({
      cameras: [
        {
          source: "shot_ir",
          sourceShotRef: CAM_REF,
          sourceRevision: CAM_REV,
          coverage: { startSec: 0, endSec: 6 },
          sampling: { kind: "discrete", fps: 24 },
          timedSamplesAvailable: true,
        },
      ],
    });
    expect(codes(validateManhuaActionPlanBindings(plan, ctx, "execution"))).toContain(
      "camera_evidence_missing",
    );
  });

  it("可连续求值的曲线：不必伪造 fps，也不报帧率低", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      cameras: [
        {
          source: "previs_cameras",
          sourceShotRef: CAM_REF,
          sourceRevision: CAM_REV,
          coverage: { startSec: 0, endSec: 6 },
          coverageBasis: "source",
          sampling: { kind: "continuous" },
          timedSamplesAvailable: true,
        },
      ],
    });
    const shot = buildShot({
      camera: {
        source: "previs_cameras",
        sourceShotRef: CAM_REF,
        sourceRevision: CAM_REV,
        timeBasis: "source",
        timedSamplesResolved: true,
      },
    });
    expect(validateManhuaActionPlanBindings(buildPlan(shot), ctx, "execution")).toEqual([]);
  });

  it("P2 落地表面冲突：计划写甲板、解析写水面必须拒绝", () => {
    const shot = buildShot();
    (shot.events[0] as { landing: { surfaceRef?: string } }).landing.surfaceRef = "surf_deck_main";
    const plan = buildPlan(shot);
    const ctx = baseContext({
      landings: [baseLanding({ surfaceRef: "surf_water", surfaceZh: "水面" })],
    });
    const hit = validateManhuaActionPlanBindings(plan, ctx, "draft").find(
      (i) => i.code === "landing_surface_conflict",
    );
    expect(hit?.severity).toBe("error");
    expect(hit?.messageZh).toMatch(/surf_deck_main/);
    expect(hit?.messageZh).toMatch(/surf_water/);
    // 表面被换掉 → 原确认失效
    expect(areManhuaPlanBindingReferencesStillValid(plan, ctx)).toBe(false);
  });

  it("P2 只有中文名且名字不同：仍报冲突", () => {
    const shot = buildShot();
    (shot.events[0] as { landing: { surfaceRef?: string } }).landing.surfaceRef = undefined;
    const plan = buildPlan(shot);
    const ctx = baseContext({
      landings: [baseLanding({ surfaceRef: undefined, surfaceZh: "水面" })],
    });
    expect(codes(validateManhuaActionPlanBindings(plan, ctx, "draft"))).toContain(
      "landing_surface_conflict",
    );
  });

  it("复合键重复：报上下文歧义，不静默取第一个", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      landings: [baseLanding(), baseLanding({ surfaceZh: "另一个同名落点" })],
    });
    const hit = validateManhuaActionPlanBindings(plan, ctx, "draft").find(
      (i) => i.code === "landing_context_ambiguous",
    );
    expect(hit?.severity).toBe("error");
  });

  it("裸 id 相同但在别的镜：按复合键查不到，报跨镜而不是误取", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      landings: [
        baseLanding({ overlayRef: { episodeIndex: 1, segmentIndex: 1, shotIndex: 9 } }),
      ],
    });
    expect(codes(validateManhuaActionPlanBindings(plan, ctx, "draft"))).toContain(
      "landing_overlay_mismatch",
    );
  });

  it("镜头来源绑定缺段号/镜号：只能验到集号，如实报出来", () => {
    const shot = buildShot({ sourceBinding: { episodeIndex: 1 } as never });
    const plan = buildPlan(shot);
    const exec = validateManhuaActionPlanBindings(plan, baseContext(), "execution");
    const hit = exec.find((i) => i.code === "shot_source_binding_missing");
    expect(hit?.severity).toBe("error");
    expect(hit?.messageZh).toMatch(/只能验到集号/);
  });

  it("落点尚未绑定角色：草稿提示、执行硬拦", () => {
    const plan = buildPlan();
    const ctx = baseContext({ landings: [baseLanding({ boundActorId: undefined })] });
    expect(validateManhuaActionPlanBindings(plan, ctx, "draft").find(
      (i) => i.code === "landing_actor_unbound",
    )?.severity).toBe("warning");
    expect(validateManhuaActionPlanBindings(plan, ctx, "execution").find(
      (i) => i.code === "landing_actor_unbound",
    )?.severity).toBe("error");
    // 「还没绑」不算引用失效
    expect(areManhuaPlanBindingReferencesStillValid(plan, ctx)).toBe(true);
  });

  it("引用有效 ≠ 可执行：缺证据时引用仍有效，但执行被拦", () => {
    // 复审点名：areManhuaPlanBindingReferencesStillValid 不是执行总开关
    const plan = buildPlan();
    const ctx = baseContext({ landings: [baseLanding({ point: screen(0.5, 0.5) })] });
    expect(areManhuaPlanBindingReferencesStillValid(plan, ctx)).toBe(true);
    expect(
      hasBlockingManhuaBindingIssues(validateManhuaActionPlanBindings(plan, ctx, "execution")),
    ).toBe(true);
  });
});

/**
 * 0915 复审 P1/P2：落地表面的**稳定身份对账**。
 * 覆盖：两边缺 / 一边缺 / 同 ID 不同名 / 不同 ID 同名 / 来源全缺 / 草稿留旧数据但执行拒绝。
 */
describe("落地表面：稳定身份对账", () => {
  /** 计划侧去掉稳定引用，只留中文名 */
  const planWithoutRef = (surfaceZh?: string) => {
    const shot = buildShot();
    const landing = (shot.events[0] as { landing: { surfaceRef?: string; surfaceZh?: string } })
      .landing;
    landing.surfaceRef = undefined;
    landing.surfaceZh = surfaceZh;
    return buildPlan(shot);
  };

  it("同一 surfaceRef、展示名不同：放行（改名不该让确认失效）", () => {
    const plan = buildPlan(); // ref=surf_deck_main, zh=甲板
    const ctx = baseContext({
      landings: [baseLanding({ surfaceRef: SURFACE_REF, surfaceZh: "主甲板" })],
    });
    expect(validateManhuaActionPlanBindings(plan, ctx, "execution")).toEqual([]);
    expect(areManhuaPlanBindingReferencesStillValid(plan, ctx)).toBe(true);
  });

  it("不同 surfaceRef、展示名相同：拒绝（同名不等于同一个表面）", () => {
    const plan = buildPlan();
    const ctx = baseContext({
      landings: [baseLanding({ surfaceRef: "surf_water_line", surfaceZh: "甲板" })],
    });
    const hit = validateManhuaActionPlanBindings(plan, ctx, "draft").find(
      (i) => i.code === "landing_surface_conflict",
    );
    expect(hit?.severity).toBe("error");
    expect(hit?.messageZh).toMatch(/surf_water_line/);
  });

  it("P1 解析来源完全没有表面信息：计划写了也不能单方面放行", () => {
    const plan = buildPlan(); // 计划侧 ref + 中文都有
    const ctx = baseContext({
      landings: [baseLanding({ surfaceRef: undefined, surfaceZh: undefined })],
    });
    const exec = validateManhuaActionPlanBindings(plan, ctx, "execution");
    const hit = exec.find((i) => i.code === "landing_surface_ref_missing");
    expect(hit?.severity).toBe("error");
    expect(hit?.messageZh).toMatch(/解析来源侧/);
    expect(hasBlockingManhuaBindingIssues(exec)).toBe(true);
  });

  it("P2 两边都只有中文且同名：草稿保留、执行拒绝", () => {
    const plan = planWithoutRef("甲板");
    const ctx = baseContext({ landings: [baseLanding({ surfaceRef: undefined, surfaceZh: "甲板" })] });
    const draft = validateManhuaActionPlanBindings(plan, ctx, "draft");
    const exec = validateManhuaActionPlanBindings(plan, ctx, "execution");
    // 草稿保留旧数据，只提示，不悄悄补造 ID
    const d = draft.find((i) => i.code === "landing_surface_ref_missing");
    expect(d?.severity).toBe("warning");
    expect(d?.messageZh).toMatch(/同名只能证明名字一样/);
    expect(hasBlockingManhuaBindingIssues(draft)).toBe(false);
    // 执行必须拒绝
    expect(exec.find((i) => i.code === "landing_surface_ref_missing")?.severity).toBe("error");
    expect(hasBlockingManhuaBindingIssues(exec)).toBe(true);
  });

  it("两边都没有任何表面信息：执行拒绝，并说明两侧都缺", () => {
    const plan = planWithoutRef(undefined);
    const ctx = baseContext({
      landings: [baseLanding({ surfaceRef: undefined, surfaceZh: undefined })],
    });
    const hit = validateManhuaActionPlanBindings(plan, ctx, "execution").find(
      (i) => i.code === "landing_surface_ref_missing",
    );
    expect(hit?.severity).toBe("error");
    expect(hit?.messageZh).toMatch(/计划侧与解析来源侧/);
  });

  it("只有解析来源有稳定引用、计划侧没有：报计划侧缺", () => {
    const plan = planWithoutRef("甲板");
    const hit = validateManhuaActionPlanBindings(plan, baseContext(), "execution").find(
      (i) => i.code === "landing_surface_ref_missing",
    );
    expect(hit?.messageZh).toMatch(/计划侧/);
    expect(hit?.messageZh).not.toMatch(/解析来源侧/);
  });

  it("非登船事件不因缺表面被拦（出水绑了落点也只核 world 点）", () => {
    const shot = buildShot({
      events: [
        {
          eventId: "ap_evt_emerge",
          kind: "emerge",
          actorId: A,
          phases: [{ kind: "burst", sourceStartSec: 0, sourceEndSec: 1 }],
          landing: {
            overlayRef: OVERLAY_REF,
            landingId: LANDING_ID,
            sourceRevision: LANDING_REV,
          },
          outcome: "emerged",
          slowMotionIntent: false,
        },
      ] as never,
    });
    const ctx = baseContext({
      landings: [baseLanding({ surfaceRef: undefined, surfaceZh: undefined })],
    });
    const codesOut = codes(validateManhuaActionPlanBindings(buildPlan(shot), ctx, "execution"));
    expect(codesOut).not.toContain("landing_surface_ref_missing");
  });

  it("plan 层：有稳定引用但没有展示名，不该被 land_without_surface 误拦", () => {
    const shot = buildShot();
    (shot.events[0] as { landing: { surfaceZh?: string } }).landing.surfaceZh = undefined;
    const plan = buildPlan(shot); // surfaceRef 仍在
    expect(
      validateManhuaActionPlan(plan, "execution").map((i) => i.code),
    ).not.toContain("land_without_surface");
  });
});
