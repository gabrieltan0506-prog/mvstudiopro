/**
 * 平台选题封面 / 分镜：人物造型与时装大片气质（全案 + 自定义共用）。
 * 风格锚点：VOGUE / ELLE / Harper's Bazaar / 好莱坞时尚编辑。
 * **场景动作决定服装**：禁止「穿高定外套打网球」类穿帮。
 */

/** 场景服饰硬锁（中文）：写入 coverPersonaContext / 分镜 scriptContext */
export const PLATFORM_SCENE_WARDROBE_LOCK_ZH = `【场景服饰·防穿帮硬锁】
- **动作决定穿什么**：画面在做什么运动/场域，人物就必须穿该场域合理服装；禁止「高定外套/西装大衣打网球」「毛衣进泳池」「礼服爬山挥汗」等穿帮。
- 网球/挥拍 → 运动短袖或网球裙/球裤、球鞋、可见球拍；可时尚运动风，**禁止**长大衣、厚外套、正装西服。
- 游泳/出水 → 泳装或防水运动外套刚披上；禁止全套正装湿身。
- 爬山/登顶 → 冲锋衣、功能外套、登山鞋；可有风感，但仍是户外装备，不是宴会大衣。
- 书房/厅堂访谈 → 才可用西装、丝绸衬衫、克制外套等时装编辑单品。
- 锁脸时：脸必须是参考人；**衣着仍须跟本条场景**，不可为保「大片感」硬套与动作冲突的外套。`.trim();

/** 场景服饰硬锁（英文）：叠加入摄影 modifiers / 英文 prompt 尾 */
export const PLATFORM_SCENE_WARDROBE_LOCK_EN = [
  "SCENE-WARDROBE HARD LOCK: outfit MUST match the depicted action and location",
  "NEVER absurd mismatches (wool/couture overcoat while playing tennis; suit diving into a pool; evening gown on a sweaty trail climb)",
  "tennis/racquet action → athletic tennis kit (tee or tennis dress/skirt, shorts, court shoes, visible racquet); fashion-sport OK, NO heavy coat/suit jacket",
  "swim → swimwear or a just-draped waterproof sport shell; never full formalwear soaking wet",
  "hike/summit → technical outdoor jacket, trail shoes; wind OK but still outdoor kit, not banquet coat",
  "indoor interview/office → then tailored suit / silk shirt / restrained coat is allowed",
  "face-lock keeps identity; wardrobe still follows this scene lock",
].join("; ");

/** 中文块：写入 coverPersonaContext / 分镜 scriptContext */
export const PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH = `【人物造型·国际时尚大片】
整体风格参考《VOGUE》《ELLE》《Harper's Bazaar》与好莱坞时尚编辑大片：高级、时尚、自信、有明星感——**但服装必须先过场景服饰硬锁**。
【人物设定】
- 妆容干净高级，皮肤细腻通透，带真实皮肤纹理与高级光泽；头发自然舒展，带轻微电影感空气感。
- **封面优先停滑抓人**：表情与姿势须丰富有戏——**帅气运动定格**（网球发球、爬山登顶、游泳出水、挥拍）或有戏表情（大笑、错愕、陶醉、坏笑、跳跃、失衡等）择一；**不要求搞笑**；禁止默认「正面端坐/端站上课脸、证件照微笑、挺拔冷淡讲课站姿」。分镜格内可更克制，但仍忌每格同一张正经正脸。
【服装要求】
- **先场景、再阶层**：场景动作决定单品类别；时装编辑气质体现在剪裁/面料/光影，**不得**用外套/礼服覆盖运动动作。
- 运动场域用高级运动装（干净剪裁、克制配色、真实面料纹理）；厅堂访谈才用西装、礼服、西装裙、丝绸衬衫等。
- 高级时装配色优先：深蓝、黑色、奶油白、灰色等克制高级色；可有一处克制强调色。
- 轻奢配饰可点缀但勿硬配：运动场景可用运动表/发带；厅堂可用腕表项链等；男女款式与种类须区分。
- 若脚本含古人/历史角色等独立造型，可例外；现代主讲/主人公须遵守上述时装编辑标准 + 场景服饰硬锁。
${PLATFORM_SCENE_WARDROBE_LOCK_ZH}`.trim();

/** 英文修饰：叠加入摄影 modifiers / 英文 prompt 尾 */
export const PLATFORM_FASHION_EDITORIAL_CHARACTER_EN = [
  "VOGUE / ELLE / Harper's Bazaar / Hollywood fashion-editorial character styling",
  "high-fashion, confident, celebrity presence; for covers prefer expressive stop-scroll moments (laugh, surprise, bliss, smirk, jump, off-balance, lean-in) — never default stiff frontal lecture-pose or ID-photo smile",
  "clean elevated makeup, refined translucent skin with real texture and luxe sheen",
  "hair naturally flowing with cinematic airiness",
  "SCENE FIRST: wardrobe category follows the action; fashion-editorial quality via cut/fabric/light — never force couture coat onto sport action",
  "sport scenes use premium athletic kit; indoor interview may use tailored suit, evening gown, suit dress, or silk shirt with authentic wool/silk/satin/velvet texture",
  "optional understated luxury accessories gender-appropriate — never forced clutter",
  "international fashion campaign look, not cheap influencer filter aesthetic",
  PLATFORM_SCENE_WARDROBE_LOCK_EN,
].join("; ");

/** 拼入 persona / script，避免重复堆叠 */
export function appendFashionEditorialCharacterGuidance(
  base: string,
  opts?: { maxChars?: number; lang?: "zh" | "en" | "both" },
): string {
  const maxChars = opts?.maxChars ?? 4200;
  const lang = opts?.lang ?? "zh";
  const blocks: string[] = [];
  const trimmed = String(base || "").trim();
  if (trimmed) blocks.push(trimmed);
  const hasZh = /国际时尚大片|Harper'?s Bazaar|VOGUE|场景服饰·防穿帮/.test(trimmed);
  if (!hasZh && (lang === "zh" || lang === "both")) {
    blocks.push(PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH);
  } else if (lang === "zh" || lang === "both") {
    if (!/场景服饰·防穿帮/.test(trimmed) && !blocks.some((b) => /场景服饰·防穿帮/.test(b))) {
      blocks.push(PLATFORM_SCENE_WARDROBE_LOCK_ZH);
    }
  }
  if (lang === "en" || lang === "both") {
    if (!/fashion-editorial character styling/i.test(trimmed)) {
      blocks.push(`【Fashion editorial】${PLATFORM_FASHION_EDITORIAL_CHARACTER_EN}`);
    } else if (!/SCENE-WARDROBE HARD LOCK/i.test(trimmed)) {
      blocks.push(`【Scene wardrobe】${PLATFORM_SCENE_WARDROBE_LOCK_EN}`);
    }
  }
  return blocks.join("\n\n").trim().slice(0, maxChars);
}
