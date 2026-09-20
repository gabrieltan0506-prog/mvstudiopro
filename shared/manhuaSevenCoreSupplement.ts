import { extractManhuaClipUserSupplement, upsertManhuaClipUserSupplement } from './manhuaClipUserSupplement';

export const MANHUA_SEVEN_CORE_FIELDS = [
  { key: 'shotSizeZh', label: '景别' }, { key: 'angleZh', label: '角度' },
  { key: 'compositionZh', label: '构图' }, { key: 'lightingZh', label: '光影' },
  { key: 'colorZh', label: '色调' }, { key: 'motionZh', label: '动势' },
  { key: 'transitionZh', label: '转场' },
] as const;
export type ManhuaSevenCoreValues = Record<(typeof MANHUA_SEVEN_CORE_FIELDS)[number]['key'], string>;
export const emptyManhuaSevenCoreValues = (): ManhuaSevenCoreValues => Object.fromEntries(MANHUA_SEVEN_CORE_FIELDS.map(f => [f.key, ''])) as ManhuaSevenCoreValues;

function locate(prompt: string, shotIndex: number) {
  if (!Number.isSafeInteger(shotIndex) || shotIndex < 1) throw new Error('请选择有效镜头');
  const extra = extractManhuaClipUserSupplement(prompt);
  const startMarker = `【镜头七核心：${shotIndex}】`, endMarker = `【七核心结束：${shotIndex}】`;
  const start = extra.indexOf(startMarker), end = extra.indexOf(endMarker);
  if (start < 0 && end < 0) return { extra, start, end, startMarker, endMarker };
  if (start < 0 || end < start || extra.indexOf(startMarker, start + startMarker.length) >= 0 || extra.indexOf(endMarker, end + endMarker.length) >= 0
    || /【(?:镜头七核心|七核心结束)[:：]/.test(extra.slice(start + startMarker.length, end))) throw new Error('原七核心区块不完整或重复，请先修正补充指令');
  return { extra, start, end, startMarker, endMarker };
}

/** 原文字段保持原样；保留标记不能由用户字段注入。 */
export function validateManhuaSevenCoreValues(values: ManhuaSevenCoreValues) {
  for (const field of MANHUA_SEVEN_CORE_FIELDS) {
    const value = values[field.key];
    if (typeof value !== 'string' || value.length > 500) throw new Error(`${field.label}请控制在500字以内`);
    if (/[【】]/.test(value)) throw new Error('七核心内容不能包含内部区块标记【】');
  }
  if (!MANHUA_SEVEN_CORE_FIELDS.some(f => values[f.key].trim())) throw new Error('请至少填写一项导演要求');
}
export function upsertManhuaShotSevenCore(prompt: string, shotIndex: number, values: ManhuaSevenCoreValues): string {
  validateManhuaSevenCoreValues(values);
  const p = locate(prompt, shotIndex);
  if (p.start >= 0) extractManhuaShotSevenCore(prompt, shotIndex);
  const body = MANHUA_SEVEN_CORE_FIELDS.map(f => `【${f.label}】\n${values[f.key]}`).join('\n');
  const block = `${p.startMarker}\n${body}\n${p.endMarker}`;
  const extra = p.start < 0 ? [p.extra, block].filter(Boolean).join('\n\n') : p.extra.slice(0, p.start) + block + p.extra.slice(p.end + p.endMarker.length);
  return upsertManhuaClipUserSupplement(prompt, extra);
}
export function extractManhuaShotSevenCore(prompt: string, shotIndex: number): ManhuaSevenCoreValues | null {
  const p = locate(prompt, shotIndex);
  if (p.start < 0) return null;
  const body = p.extra.slice(p.start + p.startMarker.length, p.end);
  const values = emptyManhuaSevenCoreValues();
  let cursor = 1;
  if (!body.startsWith('\n')) throw new Error('原七核心字段不完整');
  MANHUA_SEVEN_CORE_FIELDS.forEach((field, index) => {
    const marker = `【${field.label}】\n`;
    if (!body.startsWith(marker, cursor)) throw new Error('原七核心字段不完整');
    cursor += marker.length;
    const next = index + 1 < MANHUA_SEVEN_CORE_FIELDS.length ? body.indexOf(`\n【${MANHUA_SEVEN_CORE_FIELDS[index + 1].label}】\n`, cursor) : body.length - 1;
    if (next < cursor || (index === MANHUA_SEVEN_CORE_FIELDS.length - 1 && !body.endsWith('\n'))) throw new Error('原七核心字段不完整');
    values[field.key] = body.slice(cursor, next);
    cursor = next + 1;
  });
  validateManhuaSevenCoreValues(values);
  return values;
}
export function clearManhuaShotSevenCore(prompt: string, shotIndex: number): string {
  const p = locate(prompt, shotIndex);
  if (p.start < 0) return prompt;
  extractManhuaShotSevenCore(prompt, shotIndex);
  return upsertManhuaClipUserSupplement(prompt, p.extra.slice(0, p.start) + p.extra.slice(p.end + p.endMarker.length));
}
