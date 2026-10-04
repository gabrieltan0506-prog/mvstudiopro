import { useCallback, useEffect, useState } from "react";

const key = (userId: string) => `mvs:advisor-visibility:${userId}`;
export function readAdvisorVisibility(storage: Pick<Storage, "getItem">, userId: string): boolean {
  try { return storage.getItem(key(userId)) !== "closed"; } catch { return true; }
}

/** 开合偏好独立于剧本与云草稿，绝不触发作品保存或计费。 */
export function useManhuaAdvisorPreference(userId?: string) {
  const [open, setOpen] = useState(true);
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const next = userId ? readAdvisorVisibility(window.localStorage, userId) : true;
    setOpen(next); setEnabled(next);
  }, [userId]);
  const choose = useCallback((next: boolean) => {
    setOpen(next); setEnabled(next);
    try { if (userId) window.localStorage.setItem(key(userId), next ? "open" : "closed"); } catch { /* 本次选择仍有效。 */ }
  }, [userId]);
  return { open, setOpen, enabled, choose };
}
