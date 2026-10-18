import { useEffect, useRef, useState } from "react";
import { currentDigitalHumanAudio, type DigitalHumanDraft, type DigitalHumanMedia as Media } from "@shared/digitalHumanStudio";
import { assertDigitalHumanKeyframeTiming, digitalHumanKeyframeRevision, type DigitalHumanKeyframe } from "@shared/digitalHumanKeyframes";
import { DigitalHumanMedia } from "./DigitalHumanStudio";

type Props = {
  draft: DigitalHumanDraft;
  disabled: boolean;
  save: (update: (draft: DigitalHumanDraft) => DigitalHumanDraft) => void;
  beforeSubmit: () => Promise<void>;
  acquireWork: (label: string) => () => void;
  uploadFile: (file: File) => Promise<Media>;
};

/** 关键图是可恢复的候选，审图与采用独立于上传。 */
export function DigitalHumanKeyframePanel(props: Props) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Record<string, string>>({});
  const alive = useRef(true), lock = useRef(false);
  const current = useRef(props);
  current.current = props;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const frames = props.draft.keyframes || [];
  const duration = currentDigitalHumanAudio(props.draft)?.durationSec;
  const fail = (e: unknown) => { if (alive.current) setError(e instanceof Error ? e.message : String(e)); };

  async function upload(files: File[]) {
    if (!files.length || lock.current || props.disabled) return;
    lock.current = true; setBusy(true); setError("");
    let release: (() => void) | undefined;
    const draftId = props.draft.id;
    try {
      if (files.length + frames.length > 24) throw new Error("每份制作稿最多保留24张关键分镜，请先整理本次上传数量");
      for (const file of files) {
        if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size <= 0 || file.size > 20 * 1024 * 1024)
          throw new Error("关键分镜支持PNG、JPEG或WebP，每张不超过20MB");
      }
      release = props.acquireWork("上传关键分镜");
      await props.beforeSubmit();
      for (const file of files) {
        const media = await props.uploadFile(file);
        if (!alive.current || current.current.draft.id !== draftId) throw new Error("上传期间制作稿已切换，未绑定到其他稿件");
        const frame: DigitalHumanKeyframe = { id: crypto.randomUUID(), label: file.name.slice(0, 120), media, useZh: "", adopted: false };
        props.save(d => {
          if (d.id !== draftId) throw new Error("制作稿已变化，未绑定图片");
          return { ...d, keyframes: [...(d.keyframes || []), frame] };
        });
        // 每张分别保存；后续上传失败仍保留此前成功的候选。
        await props.beforeSubmit();
      }
    } catch (e) { fail(e); }
    finally { release?.(); lock.current = false; if (alive.current) setBusy(false); }
  }

  function edit(id: string, patch: Partial<DigitalHumanKeyframe>) {
    try {
      setError("");
      props.save(d => ({ ...d, keyframes: (d.keyframes || []).map(frame => frame.id === id ? { ...frame, ...patch, adopted: false, reviewedRevision: undefined } : frame) }));
    } catch (e) { fail(e); }
  }

  async function adopt(id: string, revision: string) {
    if (lock.current || props.disabled) return;
    lock.current = true; setBusy(true); setError("");
    let release: (() => void) | undefined;
    try {
      release = props.acquireWork("采用关键分镜");
      await props.beforeSubmit();
      props.save(d => {
        const frame = d.keyframes?.find(item => item.id === id);
        if (!frame || checked[id] !== revision || digitalHumanKeyframeRevision(d, frame) !== revision)
          throw new Error("审图期间输入已变化，请重新核对当前图片与本人身份");
        assertDigitalHumanKeyframeTiming(frame, currentDigitalHumanAudio(d)?.durationSec);
        return { ...d, keyframes: d.keyframes!.map(item => item.id === id ? { ...item, adopted: true, reviewedRevision: revision } : item) };
      });
      await props.beforeSubmit();
    } catch (e) { fail(e); }
    finally { release?.(); lock.current = false; if (alive.current) setBusy(false); }
  }

  return <section className="dh-card dh-wide">
    <h3>关键分镜图片</h3>
    <p>上传后逐张核对人物身份、画面与动作，并绑定完整配音中的起止时间。只有采用的图片才会进入对应片段；人物身份仍以当前人物参考图为准。</p>
    <label>上传关键分镜<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={props.disabled || busy} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ""; void upload(files); }} /></label>
    <p>{duration ? `完整配音时长：${duration.toFixed(2)}秒` : "可以先上传候选；准备当前文案的完整配音后再绑定时段并采用。"}</p>
    {error && <p role="alert">{error}</p>}
    {frames.map(frame => {
      const revision = digitalHumanKeyframeRevision(props.draft, frame);
      const adopted = frame.adopted && frame.reviewedRevision === revision;
      return <details key={frame.id} open={!adopted}>
        <summary>{frame.label} · {adopted ? "已采用" : frame.adopted ? "输入变化，需重新审图" : "候选未采用"}</summary>
        <DigitalHumanMedia source={frame.media.source} kind="image" name={frame.label} />
        <label>分镜名称<input value={frame.label} maxLength={120} disabled={props.disabled || busy} onChange={e => edit(frame.id, { label: e.target.value })} /></label>
        <label>画面用途<textarea value={frame.useZh} maxLength={1000} disabled={props.disabled || busy} placeholder="例如：本人右手点选前方C面板，视线落在触点；六板正对镜头。" onChange={e => edit(frame.id, { useZh: e.target.value })} /></label>
        <label>开始秒数<input type="number" min={0} max={duration || 1800} step="0.01" value={frame.startSec ?? ""} disabled={props.disabled || busy} onChange={e => edit(frame.id, { startSec: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
        <label>结束秒数<input type="number" min={0.01} max={duration || 1800} step="0.01" value={frame.endSec ?? ""} disabled={props.disabled || busy} onChange={e => edit(frame.id, { endSec: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
        <label><input type="checkbox" checked={checked[frame.id] === revision} disabled={props.disabled || busy} onChange={e => setChecked(value => ({ ...value, [frame.id]: e.target.checked ? revision : "" }))} />我已对照本人参考图检查脸与服装，并核对画面、动作和时段</label>
        <button type="button" disabled={props.disabled || busy || checked[frame.id] !== revision || adopted} onClick={() => void adopt(frame.id, revision)}>采用到对应片段</button>
        {frame.adopted && <button type="button" disabled={props.disabled || busy} onClick={() => edit(frame.id, {})}>取消采用，保留图片</button>}
      </details>;
    })}
  </section>;
}
