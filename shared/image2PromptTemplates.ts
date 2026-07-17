/**
 * HB V4 · Image-2 一键复刻模板（图生图 / 编辑向）
 * 用户选模板后套用 prompt；含参考图时走 i2i。
 */

export type Image2PromptTemplate = {
  id: string;
  labelZh: string;
  blurbZh: string;
  /** 是否强烈依赖用户上传参考图 */
  needsReference: boolean;
  aspectHint: "4:3" | "2:3" | "3:4" | "2:1" | "原比例";
  promptZh: string;
  /** 可选英文补强 */
  promptEn?: string;
};

export const IMAGE2_PROMPT_TEMPLATES: readonly Image2PromptTemplate[] = [
  {
    id: "i2_baseball_broadcast",
    labelZh: "棒球赛直播抓拍",
    blurbZh: "看台摇臂不经意抓拍 + 直播 UI 叠层",
    needsReference: false,
    aspectHint: "4:3",
    promptZh:
      "写实风格、电视直播抓拍画质、CCTV/广播机位镜头感。韩系男爱豆、英俊、黑色凌乱湿发、小耳钉、专注看比赛；深蓝球衣胸口 Giants、袖子 LOTTE；坐在棒球场观众席、三分之二侧脸、背景模糊观众与球场灯光、长焦。直播叠加 SPOTV 台标、韩文记分牌、2024 KBO League。必须是不经意间被看台摇臂抓拍的瞬间，人物未意识到镜头，极致自然感；约 15 位观众，主角居中半侧视角。",
    promptEn:
      "handsome Korean male idol, black messy wet hair, small earrings, focused on the game, candid shot, wearing Lotte Giants dark blue baseball jersey, stadium audience seat, profile view, live sports broadcast overlay, SPOTV logo, Korean scoreboard UI, telephoto lens, 4:3",
  },
  {
    id: "i2_pro_headshot",
    labelZh: "一键职业照",
    blurbZh: "忠实锁脸 · 美式商务证件照",
    needsReference: true,
    aspectHint: "2:3",
    promptZh:
      "基于用户上传照片，忠实还原面部特征与身份，生成美式商务证件照。保留原始五官结构、肤色、年龄；深藏青色西装、白色衬衫；发型在原有轮廓上梳理整洁；肤质轻微优化不过度美化。头肩像正面直视镜头，头顶留空，比例 2:3；纯白无缝背景；均匀柔和棚拍光。底部可留姓名/职位三行文字区（可按用户填写替换）。高清锐利，无水印。",
  },
  {
    id: "i2_handdrawn_plog",
    labelZh: "手绘 Plog 注释",
    blurbZh: "白色手绘轮廓 + 日记短句",
    needsReference: true,
    aspectHint: "3:4",
    promptZh:
      "观察图片内容，为画面元素添加白色手绘注释与轮廓线。白色细线、单线略粗糙；沿外轮廓描边可有轻微抖动；箭头/虚线/弧线引导视线；日系生活感、低饱和、柔光、轻微胶片感、呼吸感强。中文手写短句（口感/温度/情绪），字小白色，勿大标题。少量蒸汽/星星点缀，不遮挡主体。Instagram story + 杂志手写笔记风。比例 3:4。japanese aesthetic, soft light, magazine style, film grain, airy negative space。",
  },
  {
    id: "i2_upscale_clarity",
    labelZh: "一键清晰 4K",
    blurbZh: "超分增强 · 禁止磨皮/改脸",
    needsReference: true,
    aspectHint: "原比例",
    promptZh:
      "基于参考图像做超高分辨率 4K 增强。严格保持面部解剖、比例、身份、表情、视线、姿势、相机角度、构图与透视不变；服装/头发/皮肤/背景结构不变。自然恢复细节（毛孔、细纹、发丝、织物纹理），禁止风格化、重新布光、磨皮、塑料感皮肤或人为光泽。去除噪点与压缩伪影，仅提升清晰度与动态范围。负面：形变、面部漂移、增删肢体、手部修改、透视扭曲、加字、虚构细节。",
  },
  {
    id: "i2_panorama_360",
    labelZh: "360° 全景",
    blurbZh: "等距柱状全景 · VR 可环绕",
    needsReference: false,
    aspectHint: "2:1",
    promptZh:
      "360 度等距柱状全景图 equirectangular panoramic photo，[在此填场景]，完整可环绕视角，左右边缘无缝衔接，适合 VR。前景中景远景层次清晰，电影级 HDR 光影，人眼高度视点，禁止普通广角/鱼眼/海报感。比例 2:1，8K panorama, realistic panoramic photography。",
  },
  {
    id: "i2_otome_card",
    labelZh: "恋爱游戏卡面",
    blurbZh: "日系超写实乙女 · 电影海报感",
    needsReference: false,
    aspectHint: "4:3",
    promptZh:
      "繁华都市夜景或浪漫私人庄园，丁达尔柔光。日系超写实乙女画风 Otome style：五官深邃、眼神深情、发丝分明、丝绸/皮革/高定西装纹理。4:3 横版电影海报构图，角色居中，樱花瓣/星光碎片/半透明 UI 点缀；香槟金/玫瑰粉/宝蓝；背景适度虚化；赛璐璐叠加厚涂，商业级二次元卡面。",
  },
  {
    id: "i2_kid_crayon",
    labelZh: "丑丑涂鸦蜡笔",
    blurbZh: "10 岁孩子蜡笔重绘",
    needsReference: true,
    aspectHint: "原比例",
    promptZh:
      "将提供图片重绘为蜡笔风格：简化细节，像 10 岁孩子画在白纸上；不要使用原图颜色；可爱俏皮天真；可加点花朵/糖果/星星/云朵等童趣装饰；色彩丰富、童话感。",
  },
  {
    id: "i2_hairstyle_grid",
    labelZh: "发型分析卡",
    blurbZh: "锁脸并排 ≥16 发型对比",
    needsReference: true,
    aspectHint: "4:3",
    promptZh:
      "基于上传人像生成高质量发型分析卡：保留原始五官与脸型。并排展示至少 16 种发型，清晰区分「最适合 / 一般 / 不推荐」。一眼看出哪种最衬脸型与气质。比例 4:3。",
    promptEn:
      "high-quality personal hairstyle analysis card, preserve original features and face shape, side-by-side comparison of at least 16 hairstyles labeled most suitable / average / not recommended, aspect ratio 4:3",
  },
  {
    id: "i2_colorwalk_sticker",
    labelZh: "Colorwalk 旅行贴纸封面",
    blurbZh: "上色块贴纸 + 下真实照片",
    needsReference: true,
    aspectHint: "3:4",
    promptZh:
      "基于上传照片生成极简旅行封面，竖版 3:4。上方 40% 纯色标题区（从原照片提取干净主色，无纹理无边框），中央仅一个扁平插画风白色粗描边旅行纪念贴纸图标；图标下方一行英文标题 [Place Name]-[Season/Year]。下方 60% 直接使用原照片，仅裁切/轻微调色/提亮/清晰度。minimal travel postcard。禁止手账拼贴、虚线框、纸纹、多图标、中文大字、水印。",
  },
  {
    id: "i2_spirit_double",
    labelZh: "武魂真身双重曝光",
    blurbZh: "半透明金色幽灵分身叠层",
    needsReference: true,
    aspectHint: "原比例",
    promptZh:
      "双重曝光：画面上方叠加半透明巨大金色「幽灵分身」，与人物穿着姿势完全一致，越大越好，可透过身体看到背后风景。阳光从缝隙斜射斑驳光影，高对比电影感偏暗，神秘清冷，写实照片质感，8K，自然户外光。原比例。",
  },
];

export function getImage2PromptTemplate(id: string): Image2PromptTemplate | null {
  return IMAGE2_PROMPT_TEMPLATES.find((t) => t.id === id) || null;
}

export function buildImage2TemplatePrompt(id: string, opts?: { subjectHint?: string }): string {
  const t = getImage2PromptTemplate(id);
  if (!t) return "";
  const hint = String(opts?.subjectHint || "").trim();
  const en = t.promptEn ? `\nEN: ${t.promptEn}` : "";
  const extra = hint ? `\n【用户补充】${hint.slice(0, 300)}` : "";
  return `【Image-2 模板·${t.labelZh}】\n画幅建议：${t.aspectHint}${t.needsReference ? "\n须上传参考图。" : ""}\n${t.promptZh}${en}${extra}`;
}

export function buildImage2TemplateInjectBlock(ids: string[]): string {
  const picked = ids.map(getImage2PromptTemplate).filter(Boolean) as Image2PromptTemplate[];
  if (!picked.length) return "";
  return picked.map((t) => buildImage2TemplatePrompt(t.id)).join("\n\n---\n\n");
}
