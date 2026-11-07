/** 只修改JSON结构标点；所有正文字符串和数值保留，采用前仍须通过完整业务合同。 */
export class KnowledgeJsonSyntaxError extends Error {
  readonly code = 'knowledge_json_syntax';
  constructor(readonly detail: string) {
    super(`模型返回的JSON无法无损解析，已保留原回包并停止自动付费重试：${detail}`);
    this.name = 'KnowledgeJsonSyntaxError';
  }
}
type Repair = { position: number; removed: string; inserted: string; reason: string };
function structure(text: string, end = text.length) {
  const stack: string[] = []; let quoted = false, escaped = false;
  for (const ch of text.slice(0, end)) {
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== (ch === '}' ? '{' : '[')) return null;
    }
  }
  return { stack, quoted };
}
export function parseKnowledgeModelJson(content: string): { value: unknown; repairs: Repair[] } {
  let current = content;
  const repairs: Repair[] = [];
  const edit = (position: number, removed: string, inserted: string, reason: string) => {
    repairs.push({ position, removed, inserted, reason });
    current = current.slice(0, position) + inserted + current.slice(position + removed.length);
  };
  const fence = current.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) { repairs.push({position:0,removed:'JSON代码围栏',inserted:'',reason:'仅剥离完整包裹的代码围栏'}); current = fence[1]; }
  for (;;) {
    try { return { value: JSON.parse(current), repairs }; }
    catch (error) {
      const detail = error instanceof Error ? error.message : 'JSON语法错误';
      if (repairs.length >= 32) throw new KnowledgeJsonSyntaxError(detail);
      // Node版本的Unexpected token错误可能不带位置；只扫描字符串外的尾逗号。
      let trailingComma = -1;
      for (const match of Array.from(current.matchAll(/,(\s*[}\]])/g))) {
        const at = match.index!, state = structure(current,at), prior = current.slice(0,at).trimEnd().at(-1);
        const closing = match[1].trim();
        if (state && !state.quoted && state.stack.at(-1) === (closing === '}' ? '{' : '[') && prior && !['[','{',',',':'].includes(prior)) { trailingComma = at; break; }
      }
      if (trailingComma >= 0) { edit(trailingComma, ',', '', '移除容器结尾的多余逗号，不删除内容'); continue; }
      const position = Number(/position (\d+)/.exec(detail)?.[1]);
      const prefix = Number.isInteger(position) ? current.slice(0, position) : '';
      if (/Unexpected non-whitespace character after JSON/.test(detail) && /^[\s}\]]+$/.test(current.slice(position))) {
        let complete: unknown;
        try { complete = JSON.parse(prefix); } catch { /* 前缀不完整时不能剥离尾部 */ }
        if (complete && typeof complete === 'object') {
          edit(position,current.slice(position),'','移除完整JSON对象之后的多余结束括号，不删除正文或另一对象');continue;
        }
      }
      const before = prefix.trimEnd().at(-1), next = current[position];
      const state = Number.isInteger(position) ? structure(current, position) : structure(current);
      if (!state) throw new KnowledgeJsonSyntaxError(detail);
      if (Number.isInteger(position) && state.quoted && next && next.charCodeAt(0) < 32) {
        edit(position, next, JSON.stringify(next).slice(1,-1), '转义字符串内控制字符，解码后的正文字符保持不变'); continue;
      }
      if (!state.quoted && Number.isInteger(position)) {
        // 完整末项后只有闭合符号：补齐内层容器，不补正文或字段值。
        const expectedCloser = state.stack.at(-1) === '{' ? '}' : state.stack.at(-1) === '[' ? ']' : '';
        if (expectedCloser && [']','}'].includes(next) && next !== expectedCloser &&
            /^[\s}\]]+$/.test(current.slice(position)) && ['}',']'].includes(before || '')) {
          edit(position, '', expectedCloser, '补齐末项与外层结束符之间缺失的容器括号，不改变正文'); continue;
        }
        if ((next === ']' || next === '}') && before === ',') {
          const comma = prefix.lastIndexOf(',');
          if (['[','{',',',':'].includes(prefix.slice(0,comma).trimEnd().at(-1) || '')) throw new KnowledgeJsonSyntaxError(detail);
          edit(comma, ',', '', '移除容器结尾的多余逗号，不删除内容'); continue;
        }
        if (next === '，' || next === '：') {
          edit(position, next, next === '，' ? ',' : ':', '将字符串外的全角结构标点改为JSON标点'); continue;
        }
        const arrayGap = /Expected ',' or '\]' after array element/.test(detail) && ['{','[','"'].includes(next);
        const propertyGap = /Expected ',' or '}' after property value/.test(detail) && next === '"' && /^"(?:[^"\\]|\\.)*"\s*:/.test(current.slice(position));
        const separated = /\s$/.test(prefix);
        if ((['}',']'].includes(before || '') || (before === '"' && separated)) && (arrayGap || propertyGap)) {
          edit(position, '', ',', '完整值之间补分隔逗号，不改变正文或字段值'); continue;
        }
      }
      // 只补结束结构：不补未结束的字符串、字段值或冒号；完整章节数和必需字段由业务schema核验。
      const whole = structure(current), last = current.trimEnd().at(-1);
      if (whole && !whole.quoted && whole.stack.length && ['}',']'].includes(last || '') && /Unexpected end|Expected ',' or/.test(detail) && (!Number.isInteger(position) || position >= current.length)) {
        const closers = whole.stack.reverse().map(ch => ch === '{' ? '}' : ']').join('');
        edit(current.length, '', closers, '补齐完整末项之后缺失的结束括号，不补任何正文'); continue;
      }
      throw new KnowledgeJsonSyntaxError(detail);
    }
  }
}
