export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

/** 首页试读样本 / 战略报告试读：对角水印主文案（与 SampleReportDownload、TrialWatermarkImage 一致） */
export const TRIAL_READ_WATERMARK_LINE = "MVSTUDIOPRO.COM · 试读";

/** 生图模型 prompt 用水印指令（Vertex Nano Banana / gpt-image-2 共用语义） */
export const TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION =
  `IMPORTANT: Add a subtle editorial preview watermark: repeating diagonal lines (~-26°) of EXACTLY "${TRIAL_READ_WATERMARK_LINE}" across the frame, semi-transparent (~15–22% opacity), generous spacing, sans-serif; like a premium magazine 试读 sample — do NOT fill the image with tiny unreadable paragraph text. A discreet corner emphasis is acceptable.`;
