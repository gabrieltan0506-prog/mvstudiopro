import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import VoiceInputButton from "@/components/VoiceInputButton";
import { trpc } from "@/lib/trpc";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import { codeMotionAudioClipDraftSchema } from "@shared/codeMotionAudio";
import type {
  CodeMotionAudioSource,
  CodeMotionAudioClip,
} from "@shared/codeMotionAudio";

const roles = {
  dialogue: "对白",
  narration: "旁白",
  bgm: "背景音乐",
  sfx: "音效",
} as const;
const field =
  "w-full rounded-lg border border-stone-200 bg-white px-2 py-2 text-sm";
export default function CodeMotionAudioPanel({
  projectId,
  audios,
  timeline,
  duration,
  disabled,
  onAudios,
  onTimeline,
  onTranscript,
}: {
  projectId: string;
  audios: CodeMotionAudioSource[];
  timeline?: CodeMotionAudioClip[];
  duration: number;
  disabled: boolean;
  onAudios(value: CodeMotionAudioSource[]): void;
  onTimeline(value: CodeMotionAudioClip[]): void;
  onTranscript(text: string): void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(projectId);
  generation.current = projectId;
  const alive = useRef(true);
  const latestAudios = useRef(audios);
  latestAudios.current = audios;
  const latestOnAudios = useRef(onAudios);
  latestOnAudios.current = onAudios;
  const latestOnTranscript = useRef(onTranscript);
  latestOnTranscript.current = onTranscript;
  const operation = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const upload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const archive = trpc.codeMotion.importAudio.useMutation();
  const sources = trpc.codeMotion.resolveAudios.useQuery(
    { projectId, audios },
    { enabled: !!audios.length, retry: false }
  );
  const aliveHere = (id: string) => alive.current && generation.current === id;
  const importAudio = async (file: File) => {
    const current = projectId;
    if (disabled || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      if (audios.length >= 3) throw new Error("一条作品最多保留三份音源");
      if (!file.size || file.size > 30 * 1024 * 1024)
        throw new Error("请选择不超过30 MB的音频");
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const mime = (
        {
          mp3: "audio/mpeg",
          wav: "audio/wav",
          m4a: "audio/mp4",
          webm: "audio/webm",
        } as Record<string, string>
      )[ext];
      if (!mime) throw new Error("请选择MP3、WAV、M4A或浏览器录音");
      const signed = await upload.mutateAsync({
        fileName: file.name,
        mimeType: mime,
      });
      const response = await fetch(gcsTransferUrl(signed.uploadUrl), {
        method: "PUT",
        headers: { "Content-Type": mime, ...signed.requiredHeaders },
        body: file,
      });
      if (!response.ok) throw new Error("音频上传未完成，原音保留");
      const source = await archive.mutateAsync({
        projectId: current,
        name: file.name,
        gcsUri: signed.gcsUri,
      });
      if (aliveHere(current)) {
        if (latestAudios.current.length >= 3)
          throw new Error(
            "当前音源已达到三份，已保留新上传原音，请先移除不用的音源后再导入"
          );
        latestOnAudios.current([...latestAudios.current, source]);
      }
    } catch (e) {
      if (aliveHere(current))
        setError(e instanceof Error ? e.message : "音频导入未完成");
    } finally {
      operation.current = false;
      if (aliveHere(current)) setBusy(false);
    }
  };
  const transcribe = async (source: CodeMotionAudioSource) => {
    if (disabled || operation.current) return;
    operation.current = true;
    const current = projectId;
    setBusy(true);
    setError("");
    try {
      if (source.bytes > 8 * 1024 * 1024)
        throw new Error(
          "这段音频超过8 MB，请先选较短录音；原音仍可直接用于视频"
        );
      const refreshed = await sources.refetch();
      if (refreshed.error) throw new Error("音源地址更新失败，请稍后重试");
      if (!aliveHere(current)) return;
      const url = refreshed.data?.find(a => a.id === source.id)?.url;
      if (!url) throw new Error("音源地址尚未就绪，请稍后再试");
      const response = await fetch(gcsTransferUrl(url));
      if (!response.ok) throw new Error("原音读取失败");
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(
          ...Array.from(bytes.subarray(i, i + 32768))
        );
      // 复用首页/研究页的Gemini识别入口；只有点击识别才发送原音，录音本身不调用模型。
      const result = await fetch("/api/google?op=transcribeAudio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: btoa(binary),
          mimeType: source.mimeType,
        }),
      });
      const body = await result.json();
      if (!result.ok || body.fallback || !String(body.text || "").trim())
        throw new Error("本次没有识别到可靠文字，原音保留，可手动填写");
      if (aliveHere(current))
        latestOnTranscript.current(String(body.text).trim());
    } catch (e) {
      if (aliveHere(current))
        setError(e instanceof Error ? e.message : "识别失败");
    } finally {
      operation.current = false;
      if (aliveHere(current)) setBusy(false);
    }
  };
  const patch = (i: number, value: Partial<CodeMotionAudioClip>) => {
    const parsed = codeMotionAudioClipDraftSchema.safeParse({
      ...timeline?.[i],
      ...value,
    });
    if (!parsed.success) {
      setError("请输入0至180秒，音量在0至2倍之间；原时间轴已保留");
      return;
    }
    setError("");
    onTimeline(
      (timeline || []).map((clip, k) => (i === k ? parsed.data : clip))
    );
  };
  return (
    <section className="space-y-3 rounded-2xl border border-orange-200 bg-orange-50/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">声音素材与作者录音</h3>
        <VoiceInputButton
          key={projectId}
          onRecording={importAudio}
          maxSeconds={180}
          disabled={disabled || busy || audios.length >= 3}
        />
      </div>
      <p className="text-xs leading-5 text-stone-600">
        上传MP3/WAV或直接录音，原声保留。请在想法中说明用途与位置，例如“第一段录音作开场旁白，音乐从第8秒进入”。
      </p>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
        <Upload size={15} />
        上传音频
        <input
          aria-label="上传声音素材"
          type="file"
          accept=".mp3,.wav,.m4a,.webm"
          className="sr-only"
          disabled={disabled || busy || audios.length >= 3}
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importAudio(file);
          }}
        />
      </label>
      {busy && (
        <p role="status" className="text-sm">
          正在处理声音…
        </p>
      )}
      {(error || sources.error) && (
        <p role="alert" className="text-sm text-red-700">
          {error || sources.error?.message}
        </p>
      )}
      {audios.map(source => {
        const url = sources.data?.find(a => a.id === source.id)?.url;
        return (
          <div
            key={source.id}
            className="space-y-2 rounded-xl border bg-white p-3"
          >
            <p className="text-sm">
              {source.name} · {source.duration.toFixed(2)}秒
            </p>
            {url && (
              <audio
                controls
                preload="metadata"
                src={gcsTransferUrl(url)}
                className="max-w-full"
              />
            )}
            <div className="flex flex-wrap gap-3 text-xs">
              <button
                type="button"
                disabled={busy}
                onClick={() => void sources.refetch()}
              >
                播放失败时刷新音源
              </button>
              <button
                type="button"
                disabled={disabled || busy || !url}
                onClick={() => void transcribe(source)}
              >
                用现有Gemini识别为文案
              </button>
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => onAudios(audios.filter(a => a.id !== source.id))}
              >
                移出本作品
              </button>
              {timeline && (
                <button
                  type="button"
                  disabled={disabled || busy || timeline.length >= 12}
                  onClick={() =>
                    onTimeline([
                      ...timeline,
                      {
                        sourceId: source.id,
                        role: "narration",
                        at: 0,
                        trimStart: 0,
                        duration: Math.min(source.duration, duration),
                        volume: 1,
                        fadeIn: 0,
                        fadeOut: 0,
                      },
                    ])
                  }
                >
                  加入时间轴
                </button>
              )}
            </div>
          </div>
        );
      })}
      {timeline && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            声音时间轴 · {timeline.length}段
          </p>
          {timeline.map((clip, i) => (
            <fieldset
              key={i}
              disabled={disabled || busy}
              className="space-y-2 rounded-xl border bg-white p-3"
            >
              <div className="flex gap-2">
                <select
                  aria-label={`音轨${i + 1}来源`}
                  className={field}
                  value={clip.sourceId}
                  onChange={e => patch(i, { sourceId: e.target.value })}
                >
                  {audios.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`音轨${i + 1}用途`}
                  className={field}
                  value={clip.role}
                  onChange={e =>
                    patch(i, {
                      role: e.target.value as CodeMotionAudioClip["role"],
                    })
                  }
                >
                  {Object.entries(roles).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["at", "进入秒"],
                    ["trimStart", "原音起点"],
                    ["duration", "播放秒"],
                    ["volume", "音量倍数"],
                    ["fadeIn", "渐入秒"],
                    ["fadeOut", "渐出秒"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="text-xs">
                    {label}
                    <input
                      aria-label={`音轨${i + 1}${label}`}
                      className={field}
                      type="number"
                      min={0}
                      step={0.01}
                      value={clip[key]}
                      onChange={e =>
                        patch(i, { [key]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="text-xs text-stone-500"
                onClick={() => onTimeline(timeline.filter((_, k) => k !== i))}
              >
                移除此段
              </button>
            </fieldset>
          ))}
        </div>
      )}
    </section>
  );
}
