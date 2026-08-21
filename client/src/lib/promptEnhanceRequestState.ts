/**
 * 提示词语义增强·待恢复请求编号的会话持久层。
 * 结果未知(网络中断/超时/刷新)时编号必须活过组件内存:同 block 再点增强
 * 复用旧编号,服务端按 jobs 记录恢复结果,不重复调用模型不重复扣分。
 * localKey=`${engine}\0${prompt}`:内容或引擎一变就换新编号。
 */
export type PromptEnhancePendingRequest = {
  requestId: string;
  localKey: string;
};

export function promptEnhanceStorageKey(userId: string | number, blockId: string): string {
  return `prompt-enhance:${String(userId)}:${blockId}`;
}

export function readPromptEnhancePendingRequest(
  userId: string | number,
  blockId: string,
): PromptEnhancePendingRequest | null {
  try {
    const raw = sessionStorage.getItem(promptEnhanceStorageKey(userId, blockId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PromptEnhancePendingRequest>;
    if (typeof parsed.requestId !== "string" || typeof parsed.localKey !== "string") {
      return null;
    }
    return { requestId: parsed.requestId, localKey: parsed.localKey };
  } catch {
    return null;
  }
}

export function writePromptEnhancePendingRequest(
  userId: string | number,
  blockId: string,
  value: PromptEnhancePendingRequest,
): void {
  try {
    sessionStorage.setItem(promptEnhanceStorageKey(userId, blockId), JSON.stringify(value));
  } catch {
    // 存储满/隐私模式:降级为内存态,不阻断增强
  }
}

export function clearPromptEnhancePendingRequest(
  userId: string | number,
  blockId: string,
): void {
  try {
    sessionStorage.removeItem(promptEnhanceStorageKey(userId, blockId));
  } catch {
    // 同上,清除失败不阻断
  }
}

/** 复用判定:localKey(engine+prompt)一致才复用旧编号,否则生成新编号 */
export function nextPromptEnhanceRequest(
  staged: PromptEnhancePendingRequest | null | undefined,
  localKey: string,
  generateId: () => string,
): PromptEnhancePendingRequest {
  if (staged && staged.localKey === localKey) {
    return { requestId: staged.requestId, localKey };
  }
  return { requestId: generateId(), localKey };
}
