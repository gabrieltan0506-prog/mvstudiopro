/** Syntax-only normalization. Never invent missing values or complete truncated content. */
export function parseNovelModelJson(raw: string): {
  value: unknown;
  normalized: string;
  repaired: boolean;
} {
  const source = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return {
      value: JSON.parse(source),
      normalized: source,
      repaired: source !== raw,
    };
  } catch {}
  let quoted = false,
    escaped = false,
    normalized = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      normalized += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      normalized += c;
      continue;
    }
    if (c === ",") {
      let next = i + 1;
      while (/\s/.test(source[next] || "") && next < source.length) next++;
      if (source[next] === "}" || source[next] === "]") continue;
    }
    normalized += c;
  }
  return {
    value: JSON.parse(normalized),
    normalized,
    repaired: normalized !== raw,
  };
}
