/** 首页照片工具：老照片修复并自然上色。 */
export const HOME_OLD_PHOTO_RESTORE_CREDITS = 10;

/**
 * 首页照片结果是否可被浏览器直接打开。
 * 拒绝私有桶未签名直链（典型：`home-photo/restored-*` → GCS AccessDenied）。
 */
export function isHomePhotoResultBrowserReadable(url: string): boolean {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (/[?&]X-Goog-(?:Signature|Algorithm)=/i.test(u)) return true;
  if (/[?&]X-Amz-Signature=/i.test(u)) return true;
  if (/[?&]op=flyVolumeMedia\b/i.test(u)) return true;
  if (/\.public\.blob\.vercel-storage\.com\b/i.test(u)) return true;
  // 已知坏链：私有桶 home-photo/* 未签名
  if (/\/home-photo\//i.test(u)) return false;
  if (/^https?:\/\/storage\.googleapis\.com\//i.test(u)) return false;
  if (/polished-pond-5133/i.test(u)) return false;
  return true;
}

/** 首页照片动画的独立 15 秒基准价；不得跟随画布成片价格静默变动。 */
export const HOME_PHOTO_ANIMATE_15S_CREDITS = 118;

/** 首页照片人物动起来只开放三个明确时长，避免客户端传任意秒数影响计费。 */
export const HOME_PHOTO_ANIMATE_DURATIONS = [5, 10, 15] as const;
export type HomePhotoAnimateDuration =
  (typeof HOME_PHOTO_ANIMATE_DURATIONS)[number];

/** HappyHorse 1.1 首页照片动画只开放两个明确清晰度档。 */
export const HOME_PHOTO_ANIMATE_RESOLUTIONS = ["720p", "1080p"] as const;
export type HomePhotoAnimateResolution =
  (typeof HOME_PHOTO_ANIMATE_RESOLUTIONS)[number];
export const HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION: HomePhotoAnimateResolution =
  "720p";

/**
 * OpenRouter 2026-08-07 实时视频模型目录：HappyHorse 1.1
 * 720p=$0.0988/秒；1080p=$0.1278/秒。只用于成本对账。
 */
export const HOME_PHOTO_ANIMATE_UPSTREAM_USD_PER_SECOND: Record<
  HomePhotoAnimateResolution,
  number
> = {
  "720p": 0.0988,
  "1080p": 0.1278,
};

export function isHomePhotoAnimateDuration(
  raw: unknown
): raw is HomePhotoAnimateDuration {
  const seconds = Number(raw);
  return HOME_PHOTO_ANIMATE_DURATIONS.some(duration => duration === seconds);
}

export function isHomePhotoAnimateResolution(
  raw: unknown
): raw is HomePhotoAnimateResolution {
  return HOME_PHOTO_ANIMATE_RESOLUTIONS.includes(
    raw as HomePhotoAnimateResolution
  );
}

/**
 * 720p 的 5/10/15 秒为 40/79/118；1080p 在同秒档基础上加 20%。
 * 积分不能出现小数，统一向上取整。
 */
export function homePhotoAnimateCredits(
  duration: HomePhotoAnimateDuration,
  resolution: HomePhotoAnimateResolution = HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION
): number {
  const resolutionMultiplier = resolution === "1080p" ? 1.2 : 1;
  return Math.ceil(
    (HOME_PHOTO_ANIMATE_15S_CREDITS * duration * resolutionMultiplier) / 15
  );
}

/**
 * 老照片修复固定编辑指令：只修复、上色，不允许借修复之名改脸、增删人物或重构画面。
 */
export function buildOldPhotoRestorePrompt(): string {
  return [
    "仅修复并自然上色这张老照片，输出完整照片。",
    "严格保持所有人物的身份、人数、脸型、五官比例、年龄、表情、发型、姿势、服装轮廓，以及原始构图、取景和背景布局不变。",
    "修复划痕、折痕、霉斑、褪色、噪点、模糊和局部缺损，恢复清晰但保留真实皮肤纹理与年代质感。",
    "使用鲜活、明亮、接近现代高清照片的自然配色，提升肤色、服装和环境的色彩层次与对比度；颜色要有生命力但不过饱和，不改变照片年代、服装材质或真实光线关系。",
    "禁止美颜换脸、改变体型、增删人物或物件、凭空补造文字、裁切画面、添加边框、标志或水印。",
  ].join("\n");
}
