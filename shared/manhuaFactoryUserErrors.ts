/**
 * 工厂失败 → 普通用户可读文案（不依赖 debug 面板；不泄漏供应商/模型名）。
 */

export function formatManhuaFactoryUserError(raw: string): string {
  const msg = String(raw || "").trim();
  if (!msg) return "生成失败，请稍后重试";

  // Zod / tRPC 校验原文（debug 里常见 too_big）
  if (
    /too_big|expected string to have <=\s*12000|maximum["']?\s*:\s*12000/i.test(msg) ||
    (/sourceText/i.test(msg) && /too_big|Too big/i.test(msg))
  ) {
    return "文案过长，系统无法一次处理完。设定圣经/节拍会自动分段生成；若仍失败，请刷新后重试或分集再生成。";
  }
  if (/too_big|Too big: expected string/i.test(msg)) {
    return "提交内容超出长度限制，请缩短后再试";
  }
  if (/自动分段上限|过长（约 \d+ 字）|过长（\d+ 字，上限/i.test(msg)) {
    return msg.length > 180 ? msg.slice(0, 180) : msg;
  }

  if (/关键静帧须走|禁止无底图纯文生|需要人物库垫图|须先垫人物/i.test(msg)) {
    return "关键静帧需要人物/场景参考底图才能生成。请先锁定角色并出齐定妆与场景空镜，或上传人物参考后再试。";
  }
  if (/关键静帧改图失败/i.test(msg)) {
    if (
      /string too long|maximum length 32000|prompt.*too long|Invalid 'prompt'|说明过长|放行上限|no truncate|不会再额外调用/i.test(
        msg,
      )
    ) {
      return "关键静帧失败：本镜说明过长。请缩短该镜分镜描述后重试（不会截断，也不会再额外调用文案优化）。";
    }
    if (/ref download HTTP|downloadUrl|垫图.*下载|Unable to download|could not be downloaded/i.test(msg)) {
      return "关键静帧失败：参考底图下载失败。请到资产设定点开定妆/场景预览确认能打开，再重出静帧。";
    }
    if (/Credits 不足|积分不足|PAYMENT_REQUIRED/i.test(msg)) {
      return "关键静帧失败：算力不足，请充值或稍后再试。";
    }
    if (/timeout|超时|ETIMEDOUT|AbortError/i.test(msg)) {
      return "关键静帧失败：出图超时，请稍后重试该镜（已出成功的会保留）。";
    }
    if (/content[_ ]?policy|safety|被拒绝|moderation/i.test(msg)) {
      return "关键静帧失败：画面内容未通过审核，请改分镜描述或换参考图后重试。";
    }
    if (/HTTP 429|rate limit|负载|繁忙/i.test(msg)) {
      return "关键静帧失败：出图繁忙，请稍候再点「生成关键静帧」。";
    }
    const tail = msg.replace(/^.*?关键静帧改图失败[：:]\s*/i, "").trim();
    if (tail && tail.length < 140 && !/GPT-Image|OpenAI|OpenRouter/i.test(tail)) {
      return `关键静帧生成失败：${tail}`;
    }
    return "关键静帧生成失败。请确认定妆/场景参考能打开后，再重出失败的镜头。";
  }
  if (/请先确认剧本大纲/i.test(msg)) return msg;
  if (/请先锁定人物|请先锁定场景|请先出齐/i.test(msg)) return msg;
  if (/还不能生成|还不能跑/i.test(msg)) return msg;
  if (/已取消/i.test(msg)) return "已取消生成";
  if (/Credits 不足|积分不足/i.test(msg)) {
    return "算力不足，请充值或稍后再试";
  }
  if (/成片生成失败|成片网关超时/i.test(msg)) {
    return "成片生成失败或超时，请稍后重试该段";
  }
  if (/UNAUTHORIZED|Unauthorized|登录/i.test(msg)) {
    return "登录状态已失效，请刷新页面后重试";
  }

  // 剥掉 Zod JSON 阵列外壳，只留可读句
  if (msg.includes('"code"') && msg.includes("path")) {
    if (/sourceText/i.test(msg)) {
      return "文案字段校验失败（可能过长）。设定圣经/节拍会自动分段；若仍失败请刷新后重试。";
    }
    return "输入校验未通过，请检查剧本与资产是否齐全后重试";
  }

  // 去掉节点 id 前缀：bible-e01-xxx: message
  const stripped = msg.replace(/^[a-z]+-e\d+-[a-z0-9-]+:\s*/i, "").trim();
  const out = stripped || msg;
  return out.length > 200 ? `${out.slice(0, 200)}…` : out;
}

/** 从工厂节点 id 推阶段中文名 */
export function manhuaFactoryStageLabelFromBlockId(blockId: string): string {
  const id = String(blockId || "");
  if (id.startsWith("bible-")) return "设定圣经";
  if (id.startsWith("beats-")) return "节拍表";
  if (id.startsWith("story-")) return "故事大纲";
  if (id.startsWith("reverse-")) return "编导反推";
  if (id.startsWith("keyart-")) return "关键静帧";
  if (id.startsWith("clip-")) return "成片";
  if (id.startsWith("charsheet-")) return "角色定妆";
  if (id.startsWith("sceneplate-")) return "场景空镜";
  return "生成";
}
