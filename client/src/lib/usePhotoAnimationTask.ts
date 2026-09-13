import { useEffect, useRef, useState } from "react";
import { cachePhotoTemporaryMedia } from "./photoTemporaryMedia";
import { withLongJobsFlyDirect } from "./longJobsFlyOrigin";

type Pending = {
  requestKey: string;
  taskId?: string;
  duration: number;
  credits: number;
  status: string;
};
export function usePhotoAnimationTask(
  userId: unknown,
  onResult: (url: string, credits: number, duration: number) => void
) {
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const pendingRef = useRef<Pending | null>(null);
  const identityVersion = useRef(0);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  useEffect(() => {
    let cancelled = false;
    identityVersion.current++;
    setStorageKey(null);
    setPending(null);
    pendingRef.current = null;
    void fetch("/api/me", { credentials: "include", cache: "no-store" })
      .then(async r => {
        const me = r.ok ? await r.json() : null;
        if (cancelled || !Number.isSafeInteger(me?.id) || me.id <= 0) return;
        const key = `home-photo-animation:v1:${me.id}`;
        try {
          const saved = JSON.parse(localStorage.getItem(key) || "null");
          if (saved && /^[a-zA-Z0-9_-]{16,100}$/.test(saved.requestKey)) {
            pendingRef.current = saved;
            setPending(saved);
          }
          setStorageKey(key);
        } catch {
          setMessage("无法读取任务恢复记录，请先核对未完成任务");
        }
      })
      .catch(() => {
        if (!cancelled) setMessage("无法确认登录身份，请稍后重试");
      });
    return () => {
      cancelled = true;
      identityVersion.current++;
    };
  }, [userId]);
  function save(value: Pending | null) {
    if (storageKey) {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    }
    pendingRef.current = value;
    setPending(value);
  }
  useEffect(() => {
    if (
      !storageKey ||
      !pending ||
      ["failed", "reconcile_manual"].includes(pending.status)
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const current = pendingRef.current;
      if (!current || cancelled) return;
      try {
        const endpoint = withLongJobsFlyDirect(
          `/api/jobs?op=homePhotoAnimateStatus&requestKey=${encodeURIComponent(current.requestKey)}`
        );
        const response = await fetch(endpoint, {
          credentials: "include",
          cache: "no-store",
        });
        const data = await response.json();
        if (cancelled || pendingRef.current?.requestKey !== current.requestKey)
          return;
        if (response.ok && data.ok) {
          if (
            data.status === "succeeded" &&
            /^https?:\/\//.test(data.videoUrl || "")
          ) {
            const localUrl = await cachePhotoTemporaryMedia(
              data.videoUrl,
              "video"
            );
            if (
              cancelled ||
              pendingRef.current?.requestKey !== current.requestKey
            )
              return;
            resultRef.current(
              localUrl,
              Number(data.creditsUsed ?? current.credits),
              current.duration
            );
            save(null);
            setMessage("照片动画已生成");
            return;
          }
          if (["failed", "reconcile_manual"].includes(data.status)) {
            save({ ...current, taskId: data.taskId, status: data.status });
            setMessage(data.error || "任务已停止，请核对退款或对账记录");
            return;
          }
          if (
            data.taskId &&
            (data.taskId !== current.taskId || data.status !== current.status)
          ) {
            save({ ...current, taskId: data.taskId, status: data.status });
          }
          setMessage("照片动画正在生成，刷新后会继续查询同一任务");
        } else setMessage("暂未取得任务回执，将继续查询；请勿重复提交");
      } catch {
        if (!cancelled) setMessage("查询暂时断线，正在恢复原任务");
      }
      if (!cancelled) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [storageKey, pending?.requestKey, pending?.status]);
  async function submit(
    payload: Record<string, unknown>,
    credits: number,
    duration: number
  ) {
    if (!storageKey) throw new Error("正在确认登录身份，请稍后再试");
    if (pendingRef.current)
      throw new Error("已有照片动画任务，请先核对原任务结果");
    const version = identityVersion.current;
    const record: Pending = {
      requestKey: crypto.randomUUID(),
      duration,
      credits,
      status: "submitting",
    };
    // 保存失败时不发送，避免刷新丢失付费任务身份。
    save(record);
    try {
      const response = await fetch(
        withLongJobsFlyDirect("/api/jobs?op=homePhotoAnimate"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, requestKey: record.requestKey }),
        }
      );
      const data = await response.json();
      if (identityVersion.current !== version) return;
      if (!response.ok || !data.ok) {
        if ([400, 401, 402, 403].includes(response.status)) save(null);
        throw new Error(data.error || "提交回执未确认，请勿重复提交");
      }
      if (data.videoUrl) {
        const localUrl = await cachePhotoTemporaryMedia(data.videoUrl, "video");
        if (identityVersion.current !== version) return;
        resultRef.current(
          localUrl,
          Number(data.creditsUsed ?? credits),
          duration
        );
        save(null);
      } else
        save({
          ...record,
          taskId: data.taskId,
          status: data.status || "queued",
        });
    } catch (e) {
      if (identityVersion.current !== version) return;
      setMessage(e instanceof Error ? e.message : "提交回执未知，请勿重复提交");
      throw e;
    }
  }
  return {
    submit,
    pending,
    message,
    ready: Boolean(storageKey),
    clearFailed: () => {
      if (pendingRef.current?.status === "failed") save(null);
    },
  };
}
