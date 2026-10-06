/** 原混音卡完整来源快照的会话版本；不把素材地址发给模型或保存到候选。 */
export function createAdvisorScoringSourceGuard(newId: () => string = () => crypto.randomUUID()) {
  let serialized: string | undefined;
  let sourceKey = "";
  return {
    update(source: unknown): string {
      const next = JSON.stringify(source);
      if (!sourceKey || next !== serialized) {
        serialized = next;
        sourceKey = `scoring:${newId()}`;
      }
      return sourceKey;
    },
    assert(expected: string | undefined): void {
      if (!expected || expected !== sourceKey) {
        throw new Error("成片、配乐或混音参数已变化，请重新读取当前选择并准备混音方案，未提交旧方案");
      }
    },
  };
}
