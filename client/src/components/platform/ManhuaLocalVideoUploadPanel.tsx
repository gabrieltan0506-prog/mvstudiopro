import { useEffect, useRef, useState } from "react";
import {
  assertCompletedManhuaLocalVideoUpload,
  getManhuaLocalVideoUpload,
  readSavedManhuaLocalVideoUpload,
  saveManhuaLocalVideoUpload,
  uploadManhuaLocalVideo,
  type CompletedManhuaLocalVideoUpload,
  type ManhuaLocalVideoUpload,
  type ManhuaLocalVideoUploadAttempt,
} from "@/lib/manhuaLocalVideoUpload";

type Props = {
  userKey: string;
  disabled?: boolean;
  /** 素材分析入口传入已经选择的File；学习面板自己提供文件选择器。 */
  selectedFile?: File;
  onReady: (upload: CompletedManhuaLocalVideoUpload) => void;
  onSourceReset?: () => void;
  onBusyChange?: (busy: boolean) => void;
};

export function ManhuaLocalVideoUploadPanel({ userKey, disabled, selectedFile, onReady, onSourceReset, onBusyChange }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<ManhuaLocalVideoUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const attempt = useRef<ManhuaLocalVideoUploadAttempt | null>(null);
  const controller = useRef<AbortController | null>(null);
  const scope = useRef(userKey);
  const currentCallbacks = useRef({ onReady, onBusyChange, onSourceReset });
  currentCallbacks.current = { onReady, onBusyChange, onSourceReset };

  useEffect(() => {
    scope.current = userKey;
    attempt.current = null;
    setBusy(false);
    setFile(null);
    setError("");
    const saved = readSavedManhuaLocalVideoUpload(userKey);
    setUpload(saved);
    setMessage(saved?.status === "uploading"
      ? "上次上传未完成。刷新后请重新选择视频并重新上传，避免把不同文件拼接。"
      : "");
    const abort = new AbortController();
    let disposed = false;
    if (saved?.status === "completed" && !selectedFile) {
      controller.current = abort;
      setBusy(true);
      void getManhuaLocalVideoUpload(saved.uploadId, { signal: abort.signal }).then((value) => {
        if (disposed) return;
        const completed = assertCompletedManhuaLocalVideoUpload(value, userKey);
        setUpload(completed);
        setMessage("视频已上传并校验，可在学习区点击学节奏。");
        currentCallbacks.current.onReady(completed);
      }).catch(() => {
        if (!disposed) setError("暂时无法确认上次上传，请稍后重新查询。");
      }).finally(() => {
        if (!disposed) { controller.current = null; setBusy(false); }
      });
    }
    return () => {
      disposed = true;
      abort.abort();
      controller.current?.abort();
      controller.current = null;
      currentCallbacks.current.onBusyChange?.(false);
    };
    // selectedFile变动由下方独立处理，避免重新挂载账号恢复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);

  useEffect(() => {
    if (!selectedFile) return;
    controller.current?.abort();
    attempt.current = null;
    currentCallbacks.current.onSourceReset?.();
    saveManhuaLocalVideoUpload(userKey, null);
    setFile(selectedFile);
    setUpload(null);
    setError("");
    setMessage("上传完成只准备素材；点击学节奏后才开始学习。");
  }, [selectedFile]);

  useEffect(() => { currentCallbacks.current.onBusyChange?.(busy); }, [busy]);

  const start = async () => {
    if (controller.current || disabled || !userKey) return;
    const requestUserKey = userKey;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setMessage("正在上传视频…");
    try {
      let completed: CompletedManhuaLocalVideoUpload;
      if (!file && upload?.status === "completed") {
        completed = assertCompletedManhuaLocalVideoUpload(
          await getManhuaLocalVideoUpload(upload.uploadId, { signal: abort.signal }), userKey,
        );
      } else {
        if (!file) throw new Error("请先选择本地视频。");
        completed = await uploadManhuaLocalVideo({
          file, previous: attempt.current, userKey, signal: abort.signal,
          onCheckpoint: (next) => {
            if (abort.signal.aborted || scope.current !== requestUserKey) return;
            attempt.current = next;
            setUpload(next.upload);
            saveManhuaLocalVideoUpload(userKey, next.upload);
          },
          onProgress: (offset, bytes) => {
            if (abort.signal.aborted || scope.current !== requestUserKey) return;
            setMessage(offset === bytes ? "文件已传完，正在校验视频…"
              : `正在上传 ${Math.floor(offset / bytes * 100)}%`);
          },
        });
      }
      if (abort.signal.aborted || scope.current !== requestUserKey) return;
      setUpload(completed);
      saveManhuaLocalVideoUpload(userKey, completed);
      setMessage("视频已上传并校验，可在学习区点击学节奏。");
      currentCallbacks.current.onReady(completed);
    } catch (caught) {
      if (scope.current !== requestUserKey || controller.current !== abort) return;
      if (abort.signal.aborted) setMessage("已暂停上传。保留本页与原文件，可继续同一上传。");
      else setError(caught instanceof Error ? caught.message : "上传暂未确认，请稍后继续原上传。");
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <section aria-label="本地视频上传" className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-400/5 p-3 text-xs text-cyan-50">
      <p className="font-semibold">本地视频学节奏</p>
      <p className="mt-1 text-[11px] text-cyan-50/65">原片上传到服务器后，按学习区设置的每片秒数切片。单文件最多 800MB；上传不会自动开始学习。</p>
      {!selectedFile ? (
        <label className="mt-2 block">
          <span className="mr-2">选择本地视频</span>
          <input type="file" accept="video/*,.mp4,.mov,.mkv,.webm" disabled={busy || disabled}
            onChange={(event) => {
              const next = event.target.files?.[0];
              event.target.value = "";
              if (!next) return;
              // 新File即新上传；相同文件名/大小也不能证明内容相同。
              attempt.current = null;
              currentCallbacks.current.onSourceReset?.();
              saveManhuaLocalVideoUpload(userKey, null);
              setFile(next);
              setUpload(null);
              setError("");
              setMessage("已选择视频，点击上传后准备学习素材。");
            }} />
        </label>
      ) : null}
      {file ? <p className="mt-2 break-all">{file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB</p> : null}
      {upload && !file ? <p className="mt-2 break-all">{upload.fileName} · {(upload.bytes / 1024 / 1024).toFixed(1)}MB</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || disabled || (!file && upload?.status !== "completed")}
          onClick={() => void start()} className="rounded-lg border border-cyan-300/35 px-3 py-1.5 disabled:opacity-40">
          {busy ? "正在处理…" : upload?.status === "completed" ? "确认已上传视频" : attempt.current ? "继续上传" : "上传视频"}
        </button>
        {busy ? <button type="button" onClick={() => controller.current?.abort()}
          className="rounded-lg border border-white/20 px-3 py-1.5">暂停上传</button> : null}
        {upload ? <progress aria-label="视频上传进度" max={upload.bytes} value={upload.offset} /> : null}
      </div>
      {message ? <p role="status" className="mt-2 text-cyan-50/75">{message}</p> : null}
      {error ? <p role="alert" className="mt-2 text-rose-200">{error}</p> : null}
    </section>
  );
}
