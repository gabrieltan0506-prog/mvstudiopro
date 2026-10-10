import { useEffect, useRef, useState } from "react";
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
type Pending = {
  projectId: string;
  expectedGeneration: string;
  requestId: string;
  changes: { index: number; heading: string; body: string }[];
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
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirmOpen, setConfirmOpen] = useState(false),
    [pending, setPending] = useState<Pending | null>(null);
  const lock = useRef(false);
  const submit = trpc.codeMotionProduction.revisionSubmit.useMutation();
  const quote = trpc.codeMotionProduction.revisionQuote.useQuery(
    { projectId: project.id },
    { enabled: !disabled, retry: false }
  );
  const storageKey = user ? `ink-revision:${user.id}:${project.id}` : null;
  useEffect(() => {
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
        !Array.isArray(value.changes)
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
          changes: [{ index, heading, body }],
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
        修改选定镜头的文字与代码画面，沿用已有场景图、旁白和配乐。其余镜头保留。
      </p>
      <p className="text-xs">
        {quote.data?.message || "完成当前版本成片后可修改。"}
        {quote.data?.tier === "free"
          ? ` 剩余 ${quote.data.remaining} 次。`
          : ""}
      </p>
      <select
        aria-label="选择修改镜头"
        disabled={disabled || busy || !!pending}
        value={index}
        onChange={e => setIndex(Number(e.target.value))}
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
        onChange={e => setHeading(e.target.value)}
        maxLength={48}
      />
      <textarea
        aria-label="修改画面文字"
        disabled={disabled || busy || !!pending}
        className="block w-full rounded border p-2"
        value={pending?.changes[0].body ?? body}
        onChange={e => setBody(e.target.value)}
        maxLength={100}
      />
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
        onClick={() => setConfirmOpen(true)}
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
            <AlertDialogDescription>
              {pending
                ? "恢复原修改使用相同请求，不再消耗免费修改次数。"
                : quote.data?.tier === "free"
                  ? `本次确认提交将使用1次免费修改，提交后剩余${Math.max(0, (quote.data.remaining ?? 0) - 1)}次。取消不会消耗次数。`
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
        当前局部修改不重调生成模型，新增工具生成须接入实际成本结算后再提交。
      </p>
    </section>
  );
}
