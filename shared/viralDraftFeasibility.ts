/** 仅拦截文本能明确证明的矛盾；不替代事实审稿、试读或实际媒体检查。 */
export function mainActionKinds(text: string): string[] {
  const positive = text.replace(/“[^”]*”|「[^」]*」|"[^\"]*"/g, " ")
    .replace(/(?:不必|不用|无需|不要|不要求)[^，,。；;\n]*/g, " ");
  const kinds: string[] = [];
  if (/关注/.test(positive)) kinds.push("关注");
  if (/评论区(?:留言|聊|说|写|分享)|(?:请|欢迎|来|去|或|也|再|并|同时|顺便)\s*(?:评论|留言)/.test(positive)) kinds.push("评论");
  if (/私信|站内咨询|预约|联系咨询/.test(positive)) kinds.push("咨询");
  if (/购买|下单/.test(positive)) kinds.push("购买");
  if (/领取|下载资料/.test(positive)) kinds.push("领取");
  return kinds;
}

export function speechFeasibilityFindings(script: string, cells: Array<{ dialogueZh: string; editNoteZh?: string }>, context = "") {
  const findings: Array<{ code: string; message: string }> = [];
  const spans = Array.from(script.matchAll(/(\d{1,2}):(\d{2})\s*[–—\-~～]\s*(\d{1,2}):(\d{2})/g))
    .map(m => ({ from: Number(m[1]) * 60 + Number(m[2]), to: Number(m[3]) * 60 + Number(m[4]) }));
  if (!spans.length) for (const match of Array.from(script.matchAll(/(\d+(?:\.\d+)?)\s*[–—\-~～]\s*(\d+(?:\.\d+)?)\s*秒/g)))
    spans.push({from:Number(match[1]),to:Number(match[2])});
  const hanCount = (value: string) => (value.match(new RegExp("\\p{Script=Han}", "gu")) || []).length;
  // 只在时间轴与逐镜表一一对应时估算，未知格式不冒充完成了时长验证。
  if (spans.length === cells.length && spans.length) {
    const fast = /说唱|快嘴|绕口令|倍速口播/i.test(context.replace(/(?:不是|不要|不做|不想)[^，,。\n]*/g, " "));
    const ceiling = fast ? 16 : 9;
    spans.forEach((span, i) => {
      if (span.to <= span.from) findings.push({ code: "speech_timing", message: `第${i + 1}镜时间区间无效，请重新分配秒位` });
      else {
        const pause = /(?:说完留|句末停|句后停|结尾停|留白)\s*(?:约)?\s*(\d+(?:\.\d+)?)\s*秒/.exec(cells[i].editNoteZh || "");
        const available = span.to - span.from - Number(pause?.[1] || 0);
        if (hanCount(cells[i].dialogueZh) && (available <= 0 || hanCount(cells[i].dialogueZh) / available > ceiling))
          findings.push({ code: "speech_timing", message: `第${i + 1}镜只有${span.to - span.from}秒${pause ? `，还要求留${pause[1]}秒停顿` : ""}，却安排${hanCount(cells[i].dialogueZh)}个汉字口播；请压缩台词或重分秒位并给停顿留时间，不临时提速。文本估算仍须实际试读` });
      }
    });
  }
  const limit = /口播[^。\n]{0,16}?不超过\s*(\d{1,4})\s*(?:个)?汉字/.exec(context);
  const count = hanCount(cells.map(cell => cell.dialogueZh).join(""));
  if (limit && count > Number(limit[1])) findings.push({ code: "speech_length", message: `本轮要求口播不超过${limit[1]}个汉字，实际逐镜合计${count}个；请压缩为完整可说的稿件` });
  return findings;
}

export function ungroundedMeasureReferences(text: string, context: string) {
  if (!context) return [];
  const positive = context.replace(/(?:不等于|不是|不代表|不能|不要|不得)[^，,。；;\n]*/g, " ");
  const matches = Array.from(text.matchAll(/\d+(?:\.\d+)?\s*(?:毫升|ml|升|千克|公斤|克)[^。！？\n]{0,80}?(?:相当于|等于|大概|约|差不多|一个|一只)[^。！？\n]{0,30}?(马克杯|普通水杯|矿泉水瓶|饭碗)/gi));
  const missing = new Set(matches.map(m => m[1]).filter(ref => {
    const near = positive.indexOf(ref);
    return near < 0 || !/\d+(?:\.\d+)?\s*(?:毫升|ml|升|千克|公斤|克)/i.test(positive.slice(Math.max(0, near - 30), near + ref.length + 30));
  }));
  return Array.from(missing).map(ref => ({ code: "measure_reference", message: `未提供${ref}的实际容积或重量，不能把数值换算成它的大小；请保留原数值与单位换算，不补造参照条件` }));
}
