import { useEffect, useRef, useState } from "react";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import type { CodeMotionProject } from "@shared/codeMotion";
import type { CodeMotionRevisionChange } from "@shared/codeMotionRevision";
import CodeMotionRevisionAssistant from "./CodeMotionRevisionAssistant";
type Pending = {
  projectId: string;
  expectedGeneration: string;
  requestId: string;
  changes: CodeMotionRevisionChange[];
  confirmedQuote?: string;
};
export default function CodeMotionRevision({
  project,
  generation,
  disabled,
  onCreated,
  execute,
}: {
  project: CodeMotionProject;
  generation: string;
  disabled: boolean;
  onCreated: (value: {
    project: CodeMotionProject;
    generation: string;
  }) => void | Promise<void>;
  execute: (action: () => Promise<void>) => Promise<void>;
}) {
  const { user } = useAuth();
  const [index, setIndex] = useState(0),
    [heading, setHeading] = useState(""),
    [body, setBody] = useState(""),
    [motionPrompt, setMotionPrompt] = useState(""),
    [price, setPrice] = useState<{
      fingerprint: string;
      credits: number;
      costUsd: number;
      sourcePreviewUrl?: string;
      shot?: { version: string; mode: string };
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirmOpen, setConfirmOpen] = useState(false),
    [pending, setPending] = useState<Pending | null>(null);
  const lock = useRef(false);
  const [proposal,setProposal]=useState<{summary:string;changes:CodeMotionRevisionChange[]}|null>(null);
  const submit = trpc.codeMotionProduction.revisionSubmit.useMutation();
  const preparePrice = trpc.codeMotionProduction.revisionPrepare.useMutation();
  const quote = trpc.codeMotionProduction.revisionQuote.useQuery(
    { projectId: project.id },
    { enabled: !disabled, retry: false }
  );
  const storageKey = user ? `ink-revision:${user.id}:${project.id}` : null;
  useEffect(() => {
    setMotionPrompt("");
    setPrice(null);
    setHeading(project.plan?.scenes[index]?.heading || "");
    setBody(project.plan?.scenes[index]?.body || "");
  }, [project.id, index]);
  useEffect(() => {
    setPending(null);
    setConfirmOpen(false);
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const value = JSON.parse(raw) as Pending;
      if (
        value.projectId !== project.id ||
        !value.requestId ||
        !value.expectedGeneration ||
        !Array.isArray(value.changes) ||
        value.changes.length < 1 || value.changes.length > 6 ||
        !Number.isInteger(value.changes[0]?.index) ||
        typeof value.changes[0]?.heading !== "string" ||
        typeof value.changes[0]?.body !== "string"
      )
        throw Error("invalid");
      setPending(value);
      setIndex(value.changes[0].index);
      setHeading(value.changes[0].heading);
      setBody(value.changes[0].body);
    } catch {
      setMessage("原修改恢复记录无法读取，请保留页面并核对原作品");
    }
  }, [storageKey, project.id]);
  const run = async () => {
    if (lock.current || !storageKey) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await execute(async () => {
        const input = pending || {
          projectId: project.id,
          expectedGeneration: generation,
          requestId: crypto.randomUUID(),
          changes: proposal?.changes.length ? proposal.changes : [
            {
              index,
              heading,
              body,
              ...(motionPrompt.trim()
                ? { motionPrompt: motionPrompt.trim() }
                : {}),
            },
          ],
          ...(price ? { confirmedQuote: price.fingerprint } : {}),
        };
        localStorage.setItem(storageKey, JSON.stringify(input));
        setPending(input);
        const saved = await submit.mutateAsync(input);
        localStorage.removeItem(storageKey);
        setPending(null);
        await onCreated(saved);
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "修改未确认，请用原请求恢复"
      );
    } finally {
      lock.current = false;
      setBusy(false);
      void quote.refetch();
    }
  };
  return (
    <section
      aria-label="局部修改"
      className="space-y-3 rounded-xl border border-stone-200 bg-white p-4"
    >
      <h3 className="font-medium">局部修改</h3>
      <p className="text-xs text-stone-600">
        修改选定镜头，沿用已有场景图、旁白和配乐。原片编辑只修改已采用的本镜4–5秒，其余镜头保留。免费使用Seedance
        2.0，付费使用2.5专用编辑。
      </p>
      <p className="text-xs">
        {quote.data?.message || "完成当前版本成片后可修改。"}
        {quote.data?.tier === "free"
          ? ` 剩余 ${quote.data.remaining} 次。`
          : ""}
      </p>
      <CodeMotionRevisionAssistant project={project} generation={generation} disabled={disabled||busy||!!pending||(quote.data?.tier==="free"&&quote.data.remaining===0)} onProposal={value=>{setProposal(value.changes.length?value:null);setPrice(null);}} />
      {proposal&&<p className="rounded bg-orange-50 p-2 text-sm">{proposal.summary}（修改画面{proposal.changes.map(c=>c.index+1).join("、")}）</p>}
      <details><summary className="cursor-pointer text-sm">高级：逐镜修改</summary>
      <select
        aria-label="选择修改镜头"
        disabled={disabled || busy || !!pending}
        value={index}
        onChange={e => {setProposal(null);setPrice(null);setIndex(Number(e.target.value));}}
        className="rounded border p-2"
      >
        {project.plan?.scenes.map((s, i) => (
          <option key={i} value={i}>
            画面{i + 1}：{s.heading}
          </option>
        ))}
      </select>
      <input
        aria-label="修改标题"
        disabled={disabled || busy || !!pending}
        className="block w-full rounded border p-2"
        value={pending?.changes[0].heading ?? heading}
        onChange={e => {setProposal(null);setPrice(null);setHeading(e.target.value);}}
        maxLength={48}
      />
      <textarea
        aria-label="修改画面文字"
        disabled={disabled || busy || !!pending}
        className="block w-full rounded border p-2"
        value={pending?.changes[0].body ?? body}
        onChange={e => {setProposal(null);setPrice(null);setBody(e.target.value);}}
        maxLength={100}
      />
      {quote.data && (
        <textarea
          aria-label="动作修改要求"
          disabled={disabled || busy || !!pending}
          className="block w-full rounded border p-2"
          value={pending?.changes[0].motionPrompt ?? motionPrompt}
          onChange={e => {
            setProposal(null);
            setMotionPrompt(e.target.value);
            setPrice(null);
          }}
          maxLength={1200}
          placeholder="可选：说明对本镜原片的修改；需已有4–5秒原片。留空仅修改文字与代码画面"
        />
      )}
      </details>
      <button
        className="rounded border px-3 py-2 disabled:opacity-50"
        disabled={
          disabled ||
          busy ||
          !storageKey ||
          (!pending &&
            (!generation ||
              !heading.trim() ||
              !quote.data?.completed ||
              (quote.data.tier === "free" && quote.data.remaining === 0)))
        }
        onClick={async () => {
          const changes=proposal?.changes.length?proposal.changes:[{index,heading,body,...(motionPrompt.trim()?{motionPrompt:motionPrompt.trim()}:{})}];
          if (!pending && changes.some(c=>c.motionPrompt)) {
            setBusy(true);
            setMessage("");
            try {
              setPrice(
                await preparePrice.mutateAsync({
                  projectId: project.id,
                  expectedGeneration: generation,
                  requestId: crypto.randomUUID(),
                  changes,
                })
              );
              setConfirmOpen(true);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "报价未确认");
            } finally {
              setBusy(false);
            }
          } else setConfirmOpen(true);
        }}
      >
        {busy
          ? "保存局部修改…"
          : pending
            ? "恢复原局部修改"
            : "确认提交局部修改"}
      </button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? "恢复原局部修改" : "确认本次局部修改"}
            </AlertDialogTitle>
            {price?.sourcePreviewUrl && (
              <video
                aria-label="本次编辑原片"
                controls
                src={gcsTransferUrl(price.sourcePreviewUrl)}
                className="max-h-56 w-full rounded"
              />
            )}
            {price?.shot && (
              <p className="text-sm">
                Seedance {price.shot.version} ·{" "}
                {price.shot.mode === "video_edit" ? "原片编辑" : "参考原片修改"}
              </p>
            )}
            <AlertDialogDescription>
              {pending
                ? "恢复原修改使用相同请求，不再消耗免费修改次数。"
                : quote.data?.tier === "free"
                  ? `本次确认提交将使用1次免费修改，提交后剩余${Math.max(0, (quote.data.remaining ?? 0) - 1)}次。取消不会消耗次数。`
                  : price
                    ? `本镜按官方单价预留上限 $${price.costUsd.toFixed(4)}，成本×2换算最多${price.credits}积分。成功后按实际输入、输出秒数核算，差额原路退回；不是供应商实扣账单。确认后在动作制作区恢复并提交本镜，使用相同报价；取消不扣费。`
                    : "本次仅修改文字与代码画面，沿用已有素材，外部工具成本为0，收费0积分。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void run();
              }}
            >
              {pending ? "确认恢复原修改" : "确认并提交修改"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {quote.data?.remaining === 0 && !pending && (
        <p className="text-sm">免费2次已用完，请充值升级后继续。</p>
      )}
      {message && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}
      <p className="text-xs text-stone-500">
        动作修改保存后，请在动作制作区生成、恢复及采用本镜；只在正式提交生成时按已确认报价扣费。未有完整已采用原片的镜头暂不支持模型编辑。短片由正式渲染末帧停留补足，长片按镜头时间窗取用；原始产物保留，不冒充新生成动作。
      </p>
    </section>
  );
}
