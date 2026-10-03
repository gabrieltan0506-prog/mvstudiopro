const URL_PATTERN = /(?:https?:\/\/|gs:\/\/|s3:\/\/|www\.)[^\s<>"'`，。；！？）】]+/gi;

/** 只用于界面展示，生产请求和持久化仍使用原文。 */
export function maskMediaUrls(text: string | null | undefined): string {
  return String(text || "").replace(URL_PATTERN, "[链接已隐藏]");
}

export function maskedUrlEditorValue(text: string): { value: string; restore: (edited: string) => string | null } {
  const replacements: Array<{ source: string; token: string }> = [];
  const value = text.replace(URL_PATTERN, source => {
    // 保持字符位置，避免 @ 资产选择器的光标偏移影响原提示词。
    const token = `[链接${replacements.length + 1}隐藏]`.padEnd(source.length, "·");
    replacements.push({ source, token });
    return token;
  });
  return {
    value,
    restore(edited) {
      let prefix = 0;
      while (prefix < value.length && prefix < edited.length && value[prefix] === edited[prefix]) prefix++;
      let suffix = 0;
      while (suffix < value.length - prefix && suffix < edited.length - prefix && value[value.length - 1 - suffix] === edited[edited.length - 1 - suffix]) suffix++;
      for (const { source, token } of replacements) {
        const count = edited.split(token).length - 1;
        if (count === 0) {
          const start = value.indexOf(token);
          // 可整块删除链接；禁止局部改坏或复制遮罩后写回生产提示词。
          if (prefix > start || value.length - suffix < start + token.length) return null;
          continue;
        }
        if (count !== 1) return null;
        edited = edited.replace(token, source);
      }
      return edited;
    },
  };
}
