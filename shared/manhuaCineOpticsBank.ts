/**
 * 由运镜/景别描述推导焦段·光圈·景深（成对）。
 * 只认用户常写的景别与机位词；推不出则返回空，禁止往提示词塞默认光学废话。
 */

export type ManhuaCineOpticsCombo = {
  nameZh: string;
  shotSizeZh: string;
  focalMm: number;
  apertureF: number;
  dofZh: string;
  shutterHintZh?: string;
  promptZh: string;
};

type Framing =
  | "ecu"
  | "cu"
  | "mcu"
  | "ms"
  | "ws"
  | "ews"
  | null;

function detectFraming(t: string): Framing {
  if (/大特写|眼部特写|瞳孔/.test(t)) return "ecu";
  if (/特写/.test(t)) return "cu";
  if (/近景|中近景|胸像|过肩/.test(t)) return "mcu";
  if (/中全景|全景/.test(t)) return "ws";
  if (/远景|大远景/.test(t)) return "ews";
  if (/中景/.test(t)) return "ms";
  return null;
}

function hasCameraSignal(t: string): boolean {
  return Boolean(
    detectFraming(t) ||
      /仰拍|仰视|俯拍|俯视|跟拍|侧跟|推进|推近|拉远|环绕|手持|广角|长焦|浅景深|深景深|虚化|大光圈|小光圈/.test(
        t,
      ),
  );
}

/**
 * 从运镜/景别文案解析光学；无景别/机位/景深信号时返回 null（调用方不注入）。
 */
export function recommendManhuaCineOpticsFromText(
  raw: string,
): ManhuaCineOpticsCombo | null {
  const t = String(raw || "").trim();
  if (!t || !hasCameraSignal(t)) return null;

  const framing = detectFraming(t);
  const wantShallow = /浅景深|虚化|大光圈|背景糊|焦外/.test(t);
  const wantDeep = /深景深|小光圈|全清晰|交代环境|建立场景/.test(t);
  const lowAngle = /仰拍|仰视|低机位/.test(t);
  const highAngle = /俯拍|俯视|高机位/.test(t);
  const trackOrChase = /跟拍|侧跟|追逐|追击|奔跑|逃亡|手持/.test(t);
  const tele = /长焦|压缩感/.test(t);
  const wide = /广角|夸张透视/.test(t);

  // 景别 → 基线焦段/光圈/景深
  let focalMm = 50;
  let apertureF = 2.8;
  let dofZh = "中景深";
  let shotSizeZh = "中景";
  let nameZh = "标准叙事";

  if (framing === "ecu") {
    focalMm = 85;
    apertureF = 1.4;
    dofZh = "极浅景深";
    shotSizeZh = "大特写";
    nameZh = "大特写";
  } else if (framing === "cu") {
    focalMm = 85;
    apertureF = 1.8;
    dofZh = "浅景深";
    shotSizeZh = "特写";
    nameZh = "特写";
  } else if (framing === "mcu") {
    focalMm = 50;
    apertureF = 2.0;
    dofZh = "浅景深";
    shotSizeZh = "近景";
    nameZh = "近景";
  } else if (framing === "ms") {
    focalMm = 50;
    apertureF = 2.8;
    dofZh = "中景深";
    shotSizeZh = "中景";
    nameZh = "中景";
  } else if (framing === "ws" || framing === "ews") {
    focalMm = 24;
    apertureF = 8;
    dofZh = "深景深";
    shotSizeZh = framing === "ews" ? "远景" : "全景";
    nameZh = shotSizeZh;
  } else if (lowAngle || wide) {
    // 无景别但有仰拍/广角：用广角中景深撑气势
    focalMm = 24;
    apertureF = 2.8;
    dofZh = "中景深";
    shotSizeZh = "中全景";
    nameZh = lowAngle ? "仰拍广角" : "广角";
  } else if (trackOrChase) {
    focalMm = 35;
    apertureF = 2.8;
    dofZh = "中景深";
    shotSizeZh = "中景";
    nameZh = "跟拍";
  } else if (tele) {
    focalMm = 135;
    apertureF = 2.8;
    dofZh = "浅景深";
    shotSizeZh = "中景";
    nameZh = "长焦";
  } else if (highAngle) {
    focalMm = 35;
    apertureF = 4;
    dofZh = "中景深";
    shotSizeZh = "中全景";
    nameZh = "俯拍";
  } else if (wantShallow || wantDeep) {
    // 只写了景深词、无景别：给成对光圈
    if (wantDeep) {
      focalMm = 35;
      apertureF = 8;
      dofZh = "深景深";
      nameZh = "深景深";
    } else {
      focalMm = 50;
      apertureF = 1.8;
      dofZh = "浅景深";
      nameZh = "浅景深";
    }
  }

  // 机位/运动修正（叠在景别上）
  if (trackOrChase && (framing === "ms" || framing === "ws" || framing === null)) {
    focalMm = Math.min(focalMm, 35);
    if (framing !== "ws") apertureF = Math.min(apertureF, 2.8);
    nameZh = nameZh === "标准叙事" ? "跟拍" : nameZh;
  }
  if (lowAngle && framing !== "cu" && framing !== "ecu" && framing !== "mcu") {
    focalMm = Math.min(focalMm, 28);
    if (wantDeep) {
      /* 保持深景深 */
    } else {
      apertureF = Math.min(apertureF, 2.8);
      if (dofZh === "深景深" && !wantDeep) dofZh = "中景深";
    }
  }
  if (wantShallow) {
    apertureF = Math.min(apertureF, 1.8);
    if (dofZh === "中景深" || dofZh === "深景深") dofZh = "浅景深";
  }
  if (wantDeep) {
    apertureF = Math.max(apertureF, 8);
    dofZh = "深景深";
  }
  if (tele && framing !== "ecu" && framing !== "cu") {
    focalMm = 135;
    apertureF = Math.min(apertureF, 2.8);
    dofZh = wantDeep ? "深景深" : "浅景深";
  }

  let shutterHintZh = "1/50";
  if (trackOrChase && /追逐|追击|奔跑|逃亡|慢快门|动感/.test(t)) {
    shutterHintZh = "1/20";
  } else if (/定格|冻结|高速|水花/.test(t)) {
    shutterHintZh = "1/1000";
  } else if (/长曝光|光轨/.test(t)) {
    shutterHintZh = "1/2";
  }

  const promptZh = [
    `${focalMm}mm`,
    `f/${apertureF}`,
    dofZh,
    lowAngle ? "低机位仰拍感" : "",
    highAngle ? "高机位俯拍感" : "",
    trackOrChase ? "跟拍/运动连贯" : "",
    `快门约 ${shutterHintZh}`,
  ]
    .filter(Boolean)
    .join("，");

  return {
    nameZh,
    shotSizeZh,
    focalMm,
    apertureF,
    dofZh,
    shutterHintZh,
    promptZh: `${promptZh}；光圈与景深成对，服务本镜运镜。`,
  };
}

/** 有信号才返回注入行；否则空串（不写默认光学） */
export function formatRecommendedCineOpticsLine(raw: string): string {
  const combo = recommendManhuaCineOpticsFromText(raw);
  if (!combo) return "";
  // 短行：给引擎；勿复读 promptZh 灌水
  return `${combo.focalMm}mm f/${combo.apertureF} ${combo.dofZh} 快门${combo.shutterHintZh || "1/50"}`;
}

/**
 * 出片时把秒轴运镜句转成光学数值，只进引擎请求，不写回节点/前台。
 */
export function appendManhuaClipEngineOptics(prompt: string): string {
  const raw = String(prompt || "").trim();
  if (!raw) return raw;
  if (/【引擎光学】/.test(raw) || /\d+mm\s*f\//.test(raw)) return raw;
  // 新秒轴：`0–5s：…动作…。近景微推。` → 取句末运镜；兼容旧「运镜：」字段
  const fromTail = Array.from(
    raw.matchAll(
      /(?:^|\n)\d+(?:\.\d+)?[–-]\d+(?:\.\d+)?s[：:][^。\n]+。\s*([^。\n]{2,40})。/g,
    ),
  ).map((m) => String(m[1] || "").trim());
  const labeled = Array.from(raw.matchAll(/运镜[：:]([^｜\n。]{1,48})/g)).map((m) =>
    String(m[1] || "").trim(),
  );
  const camBits = fromTail.length ? fromTail : labeled;
  const meaningful = camBits.filter((c) => c && c !== "近景微动");
  if (!meaningful.length) return raw;
  const line = formatRecommendedCineOpticsLine(meaningful.join("；"));
  if (!line) return raw;
  return `${raw}\n【引擎光学】${line}`;
}

/** 前台审阅：剥光学数值 */
export function stripManhuaClipEngineOpticsForUi(prompt: string): string {
  return String(prompt || "")
    .replace(/\n*【引擎光学】[^\n]*/g, "")
    .replace(/\n*【引擎光学·出片专用】[\s\S]*?(?=\n【|\s*$)/g, "")
    .replace(/\n*光学·[^\n]*/g, "")
    .replace(/\n*\d+mm\s*f\/[^\n]*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
