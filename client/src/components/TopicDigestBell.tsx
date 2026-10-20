import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { TOPIC_LANES, selectTopicCards, type TopicLane } from "@shared/topicDigest";

const button = "rounded-md border px-3 py-2 text-sm disabled:opacity-50";
export function readTopicDigestLocation(search: string) {
  const q = new URLSearchParams(search), id = q.get("topicDigest"), topicId = q.get("topicId");
  return id && id.length <= 80 && topicId && topicId.length <= 30 ? { id, topicId } : null;
}
/** 账号改变由父组件key重挂载，查询键同时含账号scope，不能显示另一账号缓存。 */
export function TopicDigestBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [lane, setLane] = useState<TopicLane>("parenting");
  const [keywords, setKeywords] = useState("");
  const [message, setMessage] = useState("");
  const [, navigate] = useLocation();
  const query = trpc.mvAnalysis.topicDigestInbox.useQuery({ scope: userId }, { refetchInterval: 60_000, retry: false });
  const save = trpc.mvAnalysis.saveTopicDigestPreference.useMutation();
  const read = trpc.mvAnalysis.readTopicDigest.useMutation();
  const dismiss = trpc.mvAnalysis.dismissTopicDigest.useMutation();
  useEffect(() => {
    if (query.data?.preference) { setLane(query.data.preference.lane); setKeywords(query.data.preference.keywords); }
  }, [query.data?.preference?.lane, query.data?.preference?.keywords]);
  const notifications = query.data?.notifications || [];
  const unread = notifications.filter(n => !n.read).length;
  const busy = save.isPending || read.isPending || dismiss.isPending;
  const act = async (fn: () => Promise<unknown>, success = "") => {
    setMessage("");
    try { await fn(); await query.refetch(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "暂时无法保存，请稍后再试。"); }
  };
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><button type="button" aria-label={`选题通知${unread ? `，${unread}条未读` : ""}`} className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border">
      <Bell className="h-5 w-5" />{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{unread}</span>}
    </button></SheetTrigger>
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <SheetTitle>每两天，给你新的创作选题</SheetTitle>
      <SheetDescription>推荐由平台承担费用。点击选题后先带入需求，正式创作按原有规则计费。</SheetDescription>
      <p className="mt-2 text-sm">免费用户每期1条，来自DeepSeek；付费用户每期2条，由DeepSeek与GLM共同提案，再整合去重。{query.data ? `当前账号每期${query.data.recommendationCount}条。` : ""}</p>
      <div className="my-5 space-y-3 rounded-xl border p-4">
        <label className="block text-sm">我的赛道<select value={lane} onChange={e => setLane(e.target.value as TopicLane)} className="mt-1 w-full rounded border bg-background p-2">
          {Object.entries(TOPIC_LANES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label className="block text-sm">关注关键词（可选）<input value={keywords} onChange={e => setKeywords(e.target.value)} maxLength={120}
          placeholder="例如：3—6岁、情绪、绘本" className="mt-1 w-full rounded border bg-background p-2" /></label>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || query.isLoading || query.isError} className={button}
          onClick={() => void act(() => save.mutateAsync({ enabled: true, lane, keywords }), "偏好已保存。本期准备好后会投递通知，以后每两天更新。")}>{query.data?.preference?.enabled ? "保存推荐偏好" : "开启免费选题推荐"}</button>
          {query.data?.preference?.enabled && <button type="button" disabled={busy} className={button}
            onClick={() => void act(() => save.mutateAsync({ ...query.data!.preference!, enabled: false }), "已关闭后续推荐，历史选题仍可查看。")}>关闭推荐</button>}</div>
        {query.data?.preference?.enabled && <p className="text-xs text-muted-foreground">下一期更新：{new Date(query.data.nextAt).toLocaleString("zh-CN")}。本期投递后数量与选题固定，修改赛道或会员身份从下期生效。</p>}
      </div>
      {query.isError && <p role="alert">消息读取失败。<button type="button" className="underline" onClick={() => void query.refetch()}>重新读取</button></p>}
      {query.isLoading && <p role="status">正在读取消息…</p>}
      {query.data?.batchState === "unavailable" && <p role="status" className="my-3 text-sm">本期选题暂未生成成功，已有选题仍可使用。没有扣除你的积分，下一期会再更新。</p>}
      {!query.isLoading && !query.isError && notifications.length === 0 && query.data?.batchState !== "unavailable" && <p className="text-sm text-muted-foreground">{query.data?.preference?.enabled ? "本期选题准备好后会出现在这里；生成失败时不会扣除你的积分。" : "选择赛道并开启推荐，登录后即可查看新选题。"}</p>}
      {notifications.length > 0 && <p className="mb-3 text-xs text-muted-foreground">以下为最近12期，角标统计这些消息的未读数量。</p>}
      {notifications.map(n => <section key={n.id} className="mb-5 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{TOPIC_LANES[n.digest.lane]}{!n.read ? " · 新" : ""}</h3>
          {!n.read && <button type="button" className="text-xs underline" disabled={busy} onClick={() => void act(() => read.mutateAsync({ id: n.id }))}>标为已读</button>}</div>
        <p className="my-2 text-xs text-muted-foreground">{n.method === "dual" ? "双模型整合" : "DeepSeek选题"} · {new Date(n.digest.createdAt).toLocaleString("zh-CN")}{Date.now() > Date.parse(n.digest.expiresAt) ? " · 历史一期，热点时效需重新核实" : " · 本期"}</p>
        {selectTopicCards(n.digest.topics, query.data?.preference?.keywords || "", n.dismissed).map(t => <article key={t.id} className="border-t py-4">
          <p className="text-xs text-muted-foreground">{t.kind} · {t.format}{n.adopted.includes(t.id) ? " · 已采用" : ""}</p>
          <h4 className="my-1 font-medium">{t.title}</h4><p className="text-sm leading-6">{t.angle}</p>
          {t.sources.map(s => <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="mt-1 block text-xs underline">来源：{s.title} · {new Date(s.observedAt).toLocaleDateString("zh-CN")}</a>)}
          <p className="mt-3 text-sm">可以做成{t.format}：从“{t.outline[0]}”开始。点击后会带入选题、角度和内容提纲，你可以继续修改再创作。</p>
          <div className="mt-3 flex gap-2"><button type="button" className={button} onClick={() => {
            setOpen(false); navigate(`/platform?mode=create&createTool=viral&topicDigest=${encodeURIComponent(n.id)}&topicId=${encodeURIComponent(t.id)}`);
            window.dispatchEvent(new Event("mvs:platform-tab"));
          }}>用这个选题开始创作</button><button type="button" className={button} disabled={busy} onClick={() => void act(() => dismiss.mutateAsync({ id: n.id, topicId: t.id }))}>不感兴趣</button></div>
        </article>)}
        {selectTopicCards(n.digest.topics, query.data?.preference?.keywords || "", n.dismissed).length === 0 && <p className="text-sm">本期选题已隐藏，可调整关键词等待下一期。</p>}
      </section>)}
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    </SheetContent>
  </Sheet>;
}

/** 通过服务端账号所有权读取选题，不把URL文字直接覆盖用户已有草稿。 */
export function TopicDigestDraft({ userId, value, onApply, notificationId, topicId }: {
  userId: string; value: string; onApply: (value: string) => void; notificationId: string; topicId: string;
}) {
  const [message, setMessage] = useState("");
  const query = trpc.mvAnalysis.getTopicDigestDraft.useQuery({ id: notificationId, topicId, scope: userId }, { retry: false });
  const adopt = trpc.mvAnalysis.adoptTopicDigest.useMutation();
  const brief = query.data?.brief;
  const addition = brief ? `${brief}${query.data?.expired ? "\n此为历史选题，来源仅作历史灵感；发布前需重新核实热点时效。" : ""}` : "";
  const already = Boolean(addition && value.includes(addition));
  return <div className="my-3 rounded-xl border border-cyan-300/30 p-4">
    <h3 className="font-semibold">通知中的选题：{query.data?.title || "正在读取"}</h3>
    {query.isError && <p role="alert">选题无法读取或不属于当前账号。<button type="button" onClick={() => void query.refetch()}>重试读取</button></p>}
    {brief && <><p className="my-2 whitespace-pre-wrap text-sm leading-6">{brief}</p>
      {query.data?.expired && <p className="text-amber-200">这是历史选题，热点时效需重新核实。</p>}
      <button type="button" className={button} disabled={adopt.isPending || already} onClick={async () => {
        const next = [value.trim(), addition].filter(Boolean).join("\n\n");
        if (next.length > 8000) { setMessage("加入选题后超过8000字，请先精简需求；原稿未修改。"); return; }
        try { await adopt.mutateAsync({ id: notificationId, topicId }); onApply(next); setMessage("已加入原需求，可以继续选题与制作；尚未提交付费创作。"); }
        catch (error) { setMessage(error instanceof Error ? error.message : "采用失败，原稿未改动。"); }
      }}>{already ? "已加入需求" : "保留原稿，加入这个选题"}</button></>}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </div>;
}
