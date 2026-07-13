/**
 * 免登录医学多媒体/百科资源库（实测可用入口）。
 * 供 Skill / Stage2 / 文案引用拼接；禁止伪造深层文章路径——优先给 hub + 搜索 URL。
 */

export type MedicalAudience = "home" | "professional";

export type MedicalResourceKind =
  | "hub"
  | "search"
  | "3d"
  | "video"
  | "image"
  | "symptom"
  | "anatomy"
  | "first_aid"
  | "radiology";

export type MedicalResourceSite = {
  id: string;
  nameZh: string;
  nameEn: string;
  audience: MedicalAudience | "both";
  kinds: MedicalResourceKind[];
  /** 主入口（已 curl 验证 200） */
  hubUrl: string;
  /** 可选：专题子入口 */
  secondaryUrls?: Record<string, string>;
  /** 如何搜：返回可打开的搜索页；无则 null */
  buildSearchUrl?: (query: string) => string | null;
  notes: string;
  /** 实测踩坑，写入 prompt 避免模型用死链 */
  caveats?: string[];
};

function enc(q: string): string {
  return encodeURIComponent(String(q || "").trim());
}

/** 白名单站点（2026-07-13 实测） */
export const MEDICAL_RESOURCE_SITES: readonly MedicalResourceSite[] = [
  {
    id: "msd-home",
    nameZh: "默沙东诊疗手册·大众版",
    nameEn: "MSD Manuals Consumer",
    audience: "home",
    kinds: ["hub", "search", "3d", "video", "image", "symptom", "first_aid"],
    hubUrl: "https://www.msdmanuals.cn/home/resource",
    secondaryUrls: {
      multimedia: "https://www.msdmanuals.cn/home/multimedia",
      /** 大众版 3D = BioDigital 嵌入列表（不是 /3d-models） */
      biodigital3d: "https://www.msdmanuals.cn/home/pages-with-widgets/biodigital",
      images: "https://www.msdmanuals.cn/home/pages-with-widgets/images",
      videos: "https://www.msdmanuals.cn/home/pages-with-widgets/videos",
      infographics: "https://www.msdmanuals.cn/home/pages-with-widgets/infographics",
      symptoms: "https://www.msdmanuals.cn/home/symptoms",
      firstAid: "https://www.msdmanuals.cn/home/first-aid",
      healthTopics: "https://www.msdmanuals.cn/home/health-topics",
      quizzes: "https://www.msdmanuals.cn/home/pages-with-widgets/quizzes",
    },
    buildSearchUrl: (q) =>
      q.trim()
        ? `https://www.msdmanuals.cn/home/SearchResults?query=${enc(q)}`
        : "https://www.msdmanuals.cn/home/SearchResults?query=",
    notes: "大众向疾病/急救/3D；文案优先引此版。页顶可切「专业的」。",
    caveats: [
      "勿用 /home/pages-with-widgets/3d-models（404）；3D 用 biodigital。",
      "勿臆造深层 /home/.../疾病名 长路径；先 SearchResults 再引用实链。",
    ],
  },
  {
    id: "msd-professional",
    nameZh: "默沙东诊疗手册·专业版",
    nameEn: "MSD Manuals Professional",
    audience: "professional",
    kinds: ["hub", "search", "3d", "video", "image", "symptom"],
    hubUrl: "https://www.msdmanuals.cn/professional/resource",
    secondaryUrls: {
      multimedia: "https://www.msdmanuals.cn/professional/multimedia",
      models3d: "https://www.msdmanuals.cn/professional/pages-with-widgets/3d-models",
      images: "https://www.msdmanuals.cn/professional/pages-with-widgets/images",
      videos: "https://www.msdmanuals.cn/professional/pages-with-widgets/videos",
      symptoms: "https://www.msdmanuals.cn/professional/symptoms",
      clinicalCalculators:
        "https://www.msdmanuals.cn/professional/pages-with-widgets/clinical-calculators",
      labValues:
        "https://www.msdmanuals.cn/professional/resources/normal-laboratory-values/laboratory-reference-ranges",
    },
    buildSearchUrl: (q) =>
      q.trim()
        ? `https://www.msdmanuals.cn/professional/SearchResults?query=${enc(q)}`
        : "https://www.msdmanuals.cn/professional/SearchResults?query=",
    notes: "临床/机制深潜；面向医护创作者备课。科普成稿仍应用大众口径复述。",
    caveats: [
      "3d-models 页 HTML title 可能误显示「临床计算器」，但内容含 BioDigital 模型列表。",
    ],
  },
  {
    id: "medlineplus",
    nameZh: "MedlinePlus（NIH/NLM）",
    nameEn: "MedlinePlus",
    audience: "home",
    kinds: ["hub", "search", "video", "anatomy"],
    hubUrl: "https://medlineplus.gov/",
    secondaryUrls: {
      /** 用户旧链 videosandtutorials.html 已 404 */
      anatomyVideos: "https://medlineplus.gov/anatomyvideos.html",
      encyclopedia: "https://medlineplus.gov/encyclopedia.html",
      sampleHeartbeatVideo: "https://medlineplus.gov/ency/anatomyvideos/000067.htm",
    },
    buildSearchUrl: (q) =>
      q.trim()
        ? `https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v%3Aproject=medlineplus&query=${enc(q)}`
        : "https://medlineplus.gov/",
    notes: "NIH/NLM 公众健康视频与医学百科；A.D.A.M. 解剖动画入口在 anatomyvideos。",
    caveats: ["medlineplus.gov/videosandtutorials.html = 404，禁止再写。"],
  },
  {
    id: "cleveland-clinic",
    nameZh: "克利夫兰医学中心健康百科",
    nameEn: "Cleveland Clinic Health",
    audience: "home",
    kinds: ["hub", "search", "image", "symptom", "anatomy"],
    hubUrl: "https://my.clevelandclinic.org/health",
    secondaryUrls: {
      diseases: "https://my.clevelandclinic.org/health/diseases",
      symptoms: "https://my.clevelandclinic.org/health/symptoms",
      treatments: "https://my.clevelandclinic.org/health/treatments",
      body: "https://my.clevelandclinic.org/health/body",
      diagnostics: "https://my.clevelandclinic.org/health/diagnostics",
      articles: "https://my.clevelandclinic.org/health/articles",
    },
    buildSearchUrl: (q) =>
      q.trim()
        ? `https://my.clevelandclinic.org/search?q=${enc(q)}`
        : "https://my.clevelandclinic.org/health",
    notes: "高品质病患向图文与器官插画；适合「机制→生活对照」配图说明。",
  },
  {
    id: "cardiosmart",
    nameZh: "CardioSmart（ACC 病患版）",
    nameEn: "CardioSmart",
    audience: "home",
    kinds: ["hub", "search", "video", "image"],
    hubUrl: "https://www.cardiosmart.org/",
    secondaryUrls: {
      assets: "https://www.cardiosmart.org/assets",
      /** 具体病种页可用；裸 /topics 会跳到 /search */
      atrialFibrillation: "https://www.cardiosmart.org/topics/atrial-fibrillation",
      coronaryArteryDisease: "https://www.cardiosmart.org/topics/coronary-artery-disease",
      heartFailure: "https://www.cardiosmart.org/topics/heart-failure",
      heartAttack: "https://www.cardiosmart.org/topics/heart-attack",
    },
    buildSearchUrl: (q) =>
      q.trim()
        ? `https://www.cardiosmart.org/search?q=${enc(q)}`
        : "https://www.cardiosmart.org/search",
    notes: "心血管专属信息图/视频/决策辅助；主题页形如 /topics/{slug}。",
    caveats: [
      "裸链 https://www.cardiosmart.org/topics 会 302 到 /search；请用首页、/assets 或具体病种 slug。",
    ],
  },
  {
    id: "radiopaedia",
    nameZh: "Radiopaedia 放射影像库",
    nameEn: "Radiopaedia",
    audience: "professional",
    kinds: ["hub", "search", "radiology", "image"],
    hubUrl: "https://radiopaedia.org/",
    buildSearchUrl: (q) =>
      q.trim()
        ? `https://radiopaedia.org/search?q=${enc(q)}&scope=all`
        : "https://radiopaedia.org/",
    notes: "CT/MRI 标注切片 + 解剖示意图；结构异常/影像科普用。免登录浏览。",
    caveats: ["部分爬虫无 Accept:text/html 会 406；浏览器正常。"],
  },
  {
    id: "innerbody",
    nameZh: "Innerbody 人体解剖浏览器",
    nameEn: "Innerbody",
    audience: "both",
    kinds: ["hub", "anatomy", "3d"],
    hubUrl: "https://www.innerbody.com/htm/body.html",
    secondaryUrls: {
      cardiovascular: "https://www.innerbody.com/image/cardov.html",
      digestive: "https://www.innerbody.com/image/digeov.html",
      endocrine: "https://www.innerbody.com/image/endoov.html",
      nervous: "https://www.innerbody.com/image/nervov.html",
      skeletal: "https://www.innerbody.com/image/skelfov.html",
      muscular: "https://www.innerbody.com/image/musfov.html",
      urinary: "https://www.innerbody.com/image/urinov.html",
      lymphatic: "https://www.innerbody.com/image/lympov.html",
    },
    notes: "免登录系统图层面；点击部位有文字解说。适合拆结构。",
  },
  {
    id: "zygote-body",
    nameZh: "Zygote Body 3D 解剖",
    nameEn: "Zygote Body",
    audience: "both",
    kinds: ["hub", "anatomy", "3d"],
    hubUrl: "https://www.zygotebody.com/",
    notes: "网页 3D：拉杆剥层看皮肤→肌肉→骨骼→脏器血管。基础浏览免登录。",
  },
] as const;

export type MedicalResourcePick = {
  siteId: string;
  nameZh: string;
  reason: string;
  hubUrl: string;
  searchUrl: string | null;
  mediaUrls: string[];
  audience: MedicalAudience | "both";
};

const CARDIO_RE =
  /心脏|心慌|房颤|心梗|支架|TAVR|血压|胆固醇|心血管|冠脉|心衰|心率|心电图|心房|心室/;
const RADIOLOGY_RE = /CT|MRI|影像|放射|X光|X 光|切片|气胸|骨折.*片|读片/;
const ANATOMY_3D_RE = /3D|三维|解剖|器官|结构|可视化|BioDigital|剥层|透视/;
const FIRST_AID_RE = /急救|海姆立克|心肺复苏|CPR|烫伤|触电|溺水|中暑|止血|鼻出血/;
const SYMPTOM_RE = /症状|不舒服|疼|痛|发烧|咳嗽|头晕|胸闷|心悸/;
const PRO_RE = /专业版|临床计算器|实验室正常值|医护|职称|病例讨论|鉴别诊断/;

export function inferMedicalAudience(context: string): MedicalAudience {
  return PRO_RE.test(context) ? "professional" : "home";
}

function siteById(id: string): MedicalResourceSite | undefined {
  return MEDICAL_RESOURCE_SITES.find((s) => s.id === id);
}

/**
 * 按选题上下文挑 2–4 个站点 + 可打开 URL（hub/搜索/多媒体）。
 */
export function pickMedicalResources(params: {
  topic: string;
  audience?: MedicalAudience;
  max?: number;
}): MedicalResourcePick[] {
  const topic = String(params.topic || "").trim();
  const audience = params.audience ?? inferMedicalAudience(topic);
  const max = Math.max(1, Math.min(6, params.max ?? 3));
  const scored: Array<{ score: number; pick: MedicalResourcePick }> = [];

  const push = (
    siteId: string,
    score: number,
    reason: string,
    mediaKeys: string[] = [],
  ) => {
    const site = siteById(siteId);
    if (!site) return;
    if (site.audience !== "both" && site.audience !== audience && score < 20) {
      // 弱匹配且受众不符则跳过；强匹配仍可给对照
    }
    const mediaUrls = mediaKeys
      .map((k) => site.secondaryUrls?.[k])
      .filter((u): u is string => Boolean(u));
    scored.push({
      score,
      pick: {
        siteId: site.id,
        nameZh: site.nameZh,
        reason,
        hubUrl: site.hubUrl,
        searchUrl: site.buildSearchUrl?.(topic) ?? null,
        mediaUrls,
        audience: site.audience,
      },
    });
  };

  // 基线：MSD 分受众
  if (audience === "professional") {
    push("msd-professional", 30, "专业版资源/3D/症状总入口", [
      "models3d",
      "symptoms",
      "multimedia",
    ]);
    push("msd-home", 12, "成稿可用大众版对照复述", ["biodigital3d", "symptoms"]);
  } else {
    push("msd-home", 30, "大众版资源/3D(BioDigital)/急救/症状", [
      "biodigital3d",
      "videos",
      "symptoms",
      "firstAid",
    ]);
  }

  if (ANATOMY_3D_RE.test(topic) || !topic) {
    push("msd-home", 22, "3D 疾病机制可视化（BioDigital）", ["biodigital3d"]);
    push("innerbody", 18, "系统解剖图层浏览", ["cardiovascular"]);
    push("zygote-body", 16, "3D 剥层人体浏览器", []);
  }
  if (CARDIO_RE.test(topic)) {
    push("cardiosmart", 28, "ACC 心血管主题页/信息图/视频", [
      "atrialFibrillation",
      "coronaryArteryDisease",
    ]);
    push("innerbody", 14, "心血管系统交互图", ["cardiovascular"]);
  }
  if (RADIOLOGY_RE.test(topic)) {
    push("radiopaedia", 28, "标注影像 + 解剖示意图", []);
  }
  if (FIRST_AID_RE.test(topic)) {
    push("msd-home", 26, "急症与意外事故板块", ["firstAid"]);
    push("medlineplus", 14, "解剖/急救相关健康视频库", ["anatomyVideos"]);
  }
  if (SYMPTOM_RE.test(topic)) {
    push("msd-home", 20, "症状索引", ["symptoms"]);
    push("cleveland-clinic", 18, "症状/疾病百科与插画", ["symptoms", "diseases"]);
  }
  // 通用图文补强
  push("cleveland-clinic", 10, "克利夫兰病患向图文插画", ["body", "diseases"]);
  push("medlineplus", 10, "NIH 健康视频与百科", ["anatomyVideos", "encyclopedia"]);

  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: MedicalResourcePick[] = [];
  for (const row of scored) {
    if (seen.has(row.pick.siteId)) {
      // merge media urls into existing
      const exist = out.find((p) => p.siteId === row.pick.siteId);
      if (exist) {
        for (const u of row.pick.mediaUrls) {
          if (!exist.mediaUrls.includes(u)) exist.mediaUrls.push(u);
        }
        if (row.score >= 20 && row.pick.reason.length > exist.reason.length) {
          exist.reason = row.pick.reason;
        }
      }
      continue;
    }
    seen.add(row.pick.siteId);
    out.push(row.pick);
    if (out.length >= max) break;
  }
  return out;
}

/** 文案/口播可落的一句引用（含 URL） */
export function formatMedicalResourceCite(pick: MedicalResourcePick): string {
  const url = pick.searchUrl || pick.mediaUrls[0] || pick.hubUrl;
  return `公开资源可对照：${pick.nameZh}（${url}）——只作图示/机制理解，不替代就诊。`;
}

export function textHasMedicalResourceCite(text: string): boolean {
  return /默沙东|MSD\s*Manual|MedlinePlus|Cleveland Clinic|克利夫兰|CardioSmart|Radiopaedia|Innerbody|Zygote Body|msdmanuals\.cn|medlineplus\.gov|clevelandclinic\.org|cardiosmart\.org|radiopaedia\.org|innerbody\.com|zygotebody\.com/i.test(
    String(text || ""),
  );
}

export function ensureMedicalResourceCiteInCopy(params: {
  copywriting: string;
  topic?: string;
  force?: boolean;
}): { copywriting: string; patched: boolean } {
  const base = String(params.copywriting || "").trim();
  const need =
    params.force === true ||
    /医学科普|急救|解剖|3D|疾病机制|器官|症状|默沙东|心血管/.test(
      `${base} ${params.topic || ""}`,
    );
  if (!need) return { copywriting: base, patched: false };
  if (textHasMedicalResourceCite(base)) {
    return { copywriting: base, patched: false };
  }
  const pick = pickMedicalResources({
    topic: params.topic || base.slice(0, 80),
    max: 1,
  })[0];
  if (!pick) return { copywriting: base, patched: false };
  const cite = formatMedicalResourceCite(pick);
  return {
    copywriting: base ? `${base}\n\n${cite}` : cite,
    patched: true,
  };
}

/** 注入 Stage2 / Skill 的短约束块 */
export function buildMedicalResourcePromptBlock(params?: {
  topic?: string;
  audience?: MedicalAudience;
}): string {
  const topic = String(params?.topic || "").trim();
  const audience = params?.audience ?? inferMedicalAudience(topic);
  const picks = pickMedicalResources({ topic: topic || "医学科普", audience, max: 4 });
  const lines: string[] = [
    "【医学多媒体资源库 · 免登录实测入口】",
    "用途：文案/分镜可展示「动画·图片·症状页」链接；先 hub/搜索，勿臆造深层死链。",
    `受众默认：${audience === "professional" ? "专业版备课 → 成稿仍用大众口径" : "大众版科普"}。`,
    "审核：不诊断、不开方、不承诺疗效；一句资源 + 生活痛点，禁论文墙。",
    "高赞壳（mk实测·必须选1）：①大数字选题包（谁写谁火/100个/选一个就行·藏≥赞）②硬核网站+屏幕证据（MSD大众版/3D讲清原理）③八卦或漫画拟人（不当切片课）。",
    "高赞料：同条必须有可打开 URL（SearchResults 或 biodigital/anatomyvideos 等）；壳无料=口号党，料无壳=论文党。",
  ];
  for (const p of picks) {
    const media = p.mediaUrls.length ? ` | 多媒体: ${p.mediaUrls.slice(0, 2).join(" · ")}` : "";
    const search = p.searchUrl ? ` | 搜索: ${p.searchUrl}` : "";
    lines.push(`- ${p.nameZh}：${p.reason} → ${p.hubUrl}${search}${media}`);
  }
  lines.push("死链禁写：medlineplus.gov/videosandtutorials.html；msd …/home/…/3d-models；cardiosmart.org/topics（裸路径）。");
  lines.push(
    "推荐写法：按《默沙东诊疗手册大众版》公开资源中的 3D/症状页对照……（附 SearchResults 或 biodigital 链接）。",
  );
  // 全库速查（压缩）
  lines.push("全库 hub：");
  for (const s of MEDICAL_RESOURCE_SITES) {
    lines.push(`  · ${s.id}: ${s.hubUrl}`);
  }
  return lines.join("\n");
}

export function getMedicalResourceSite(id: string): MedicalResourceSite | undefined {
  return siteById(id);
}

export function listMedicalResourceHubs(): Array<{ id: string; nameZh: string; hubUrl: string }> {
  return MEDICAL_RESOURCE_SITES.map((s) => ({
    id: s.id,
    nameZh: s.nameZh,
    hubUrl: s.hubUrl,
  }));
}
