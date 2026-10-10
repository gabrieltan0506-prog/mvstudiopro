import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CodeMotionProject } from "@shared/codeMotion";
import type { CodeMotionAudioSource } from "@shared/codeMotionAudio";
import type { CodeMotionSoundRequest } from "@shared/codeMotionMedia";

export default function CodeMotionSoundProduction({
  project,
  disabled,
  save,
  adopt,
  execute,
}: {
  project: CodeMotionProject;
  disabled: boolean;
  save(): Promise<{ generation: string }>;
  adopt(source: CodeMotionAudioSource): Promise<void>;
  execute(action: () => Promise<void>): Promise<void>;
}) {
  const [direction, setDirection] = useState(
    "由轻盈铺陈推进到明亮收束，衬托旁白，纯音乐"
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const generate = trpc.codeMotion.generateSound.useMutation();
  const useSound = trpc.codeMotion.adoptSound.useMutation();
  const sounds = trpc.codeMotion.sounds.useQuery(
    { projectId: project.id },
    {
      enabled: !disabled,
      retry: false,
      refetchInterval: q =>
        q.state.data?.some(r => ["running", "queued"].includes(r.status))
          ? 4000
          : false,
    }
  );
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await execute(action);
    } catch (e) {
      if (mounted.current) setMessage(e instanceof Error ? e.message : "本次未完成，请查询原请求");
    } finally {
      if (mounted.current) { await sounds.refetch(); setBusy(false); }
      lock.current = false;
    }
  }
  async function submit(request: CodeMotionSoundRequest) {
    const saved = await save();
    if (!mounted.current) return;
    await generate.mutateAsync({
      projectId: project.id,
      generation: saved.generation,
      request,
    });
  }
  const button =
    "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
  return (
    <section
      className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4"
      aria-label="生成旁白和配乐"
    >
      <h3 className="font-medium">制作声音</h3>
      <p className="text-xs text-stone-600">
        没有现成音频也可以开始。按画面生成旁白和配乐，试听后采用到作品；生成沿用现有积分规则。
      </p>
      <button className={button} disabled={disabled || busy || !project.plan || sounds.isLoading || !!sounds.error}
        onClick={() => void run(async () => {
          const existing = (await sounds.refetch()).data;
          if (!mounted.current) return;
          if (!existing) throw new Error("请先取回已有声音记录");
          if (direction.trim().length < 2) throw new Error("请填写配乐方向");
          const saved = await save();
          for (let sceneIndex = 0; sceneIndex < (project.plan?.scenes.length || 0); sceneIndex++) {
            if (!mounted.current) return;
            const speech = project.plan!.scenes[sceneIndex].speech;
            if (!speech?.text.trim() || existing.some(r => r.request.kind === "speech" && r.request.sceneIndex === sceneIndex)) continue;
            await generate.mutateAsync({projectId:project.id,generation:saved.generation,request:{kind:"speech",requestId:crypto.randomUUID(),sceneIndex,text:speech.text.trim(),voice:speech.voice}});
          }
          if (mounted.current && !existing.some(r => r.request.kind === "bgm")) await generate.mutateAsync({projectId:project.id,generation:saved.generation,request:{kind:"bgm",requestId:crypto.randomUUID(),direction:direction.trim()}});
        })}>生成尚未制作的旁白与配乐</button>
      {project.plan?.scenes.map((scene, sceneIndex) =>
        scene.speech?.text.trim() ? (
          <div key={sceneIndex} className="space-y-2">
            <p className="text-sm">
              画面 {sceneIndex + 1}：{scene.speech.text}（
              {scene.speech.voice === "female" ? "女声" : "男声"}）
            </p>
            <button
              className={button}
              disabled={
                disabled ||
                busy ||
                sounds.isLoading ||
                !!sounds.error ||
                sounds.data?.some(
                  r =>
                    r.request.kind === "speech" &&
                    r.request.sceneIndex === sceneIndex
                )
              }
              onClick={() =>
                void run(() =>
                  submit({
                    kind: "speech",
                    requestId: crypto.randomUUID(),
                    sceneIndex,
                    text: scene.speech!.text.trim(),
                    voice: scene.speech!.voice,
                  })
                )
              }
            >
              生成本镜旁白
            </button>
          </div>
        ) : null
      )}
      <label className="block text-sm">
        配乐方向
        <textarea
          className="mt-1 w-full rounded-lg border p-2"
          maxLength={1000}
          value={direction}
          disabled={disabled || busy}
          onChange={e => setDirection(e.target.value)}
        />
      </label>
      <button
        className={button}
        disabled={
          disabled ||
          busy ||
          !project.plan ||
          direction.trim().length < 2 ||
          sounds.isLoading ||
          !!sounds.error ||
          sounds.data?.some(
            r =>
              r.request.kind === "bgm"
          )
        }
        onClick={() =>
          void run(() =>
            submit({
              kind: "bgm",
              requestId: crypto.randomUUID(),
              direction: direction.trim(),
            })
          )
        }
      >
        生成配乐
      </button>
      <button
        className={button}
        disabled={busy}
        onClick={() => void sounds.refetch()}
      >
        刷新已有声音
      </button>
      {sounds.error && (
        <p role="alert" className="text-sm text-red-700">
          {sounds.error.message}
        </p>
      )}
      {message && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}
      {sounds.data?.map(sound => (
        <article
          key={sound.request.requestId}
          className="space-y-2 rounded-lg border bg-white p-3"
        >
          <p className="text-sm">
            {sound.request.kind === "speech"
              ? `画面${sound.request.sceneIndex + 1}：${sound.request.text}`
              : sound.request.direction}
          </p>
          <p className="text-xs text-stone-500">
            {sound.status === "succeeded"
              ? "已生成，请试听后采用"
              : sound.status === "not_started"
                ? "原请求已保存，尚未开始"
                : sound.message ||
                  (sound.status === "queued"
                    ? "排队中"
                    : sound.status === "running"
                      ? "处理中"
                      : "请核对原任务结果")}
          </p>
          {sound.canResume && (
            <button
              className={button}
              disabled={disabled || busy}
              onClick={() => void run(() => submit(sound.request))}
            >
              继续原请求
            </button>
          )}
          {sound.variants.map(v => (
            <div key={v.index} className="space-y-2">
              <audio
                controls
                preload="none"
                src={v.previewUrl}
                className="w-full"
              />
              <button
                className={button}
                disabled={disabled || busy || sound.status !== "succeeded"}
                onClick={() =>
                  void run(async () => {
                    await save();
                    if (!mounted.current) return;
                    const source = await useSound.mutateAsync({
                      projectId: project.id,
                      requestId: sound.request.requestId,
                      variantIndex: v.index,
                    });
                    if (mounted.current) await adopt(source);
                  })
                }
              >
                采用
                {sound.variants.length > 1 ? `候选 ${v.index + 1}` : "此音源"}
              </button>
            </div>
          ))}
        </article>
      ))}
    </section>
  );
}
