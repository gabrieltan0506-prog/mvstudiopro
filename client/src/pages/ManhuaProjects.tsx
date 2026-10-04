import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  listLocalManhuaProjects,
  createEmptyManhuaProject,
} from "@/lib/novelFactoryProject";
export default function ManhuaProjects() {
  const { user, loading } = useAuth();
  if (loading) return <main className="p-8">正在读取账号…</main>;
  if (!user)
    return (
      <main className="p-8">
        <a href="/login">请先登录</a>
      </main>
    );
  return <Projects userId={String(user.id)} />;
}
function Projects({ userId }: { userId: string }) {
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const cloud = trpc.manhuaCloudDraft.listProjects.useQuery(undefined, {
    retry: 1,
  });
  const legacy = trpc.manhuaCloudDraft.get.useQuery(undefined, { retry: 1 });
  const [local] = useState(() => {
    try {
      return listLocalManhuaProjects(localStorage, userId);
    } catch {
      return [];
    }
  });
  const projects = new Map(
    (cloud.data?.projects || []).map(p => [p.projectId, p])
  );
  for (const item of local) {
    const prev = projects.get(item.projectId);
    if (!prev || item.updatedAt > prev.updatedAt)
      projects.set(item.projectId, item);
  }
  const items = Array.from(projects.values())
    .filter(p => p.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const phase: Record<string, string> = {
    outline: "剧本大纲",
    assets: "资产设定",
    storyboard: "分镜",
    edit: "剪辑",
    final: "成片",
  };
  return (
    <main className="min-h-screen bg-[#0e171e] p-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap justify-between gap-4">
          <h1 className="text-3xl font-semibold">我的漫剧作品</h1>
          <a href="/novel-adaptation" className="rounded-xl border px-4 py-2">
            小说改编
          </a>
        </header>
        <p className="mb-5 text-slate-400">
          每部作品独立保存剧本、资产、分镜与成片。选择作品继续制作。
        </p>
        <form
          onSubmit={e => {
            e.preventDefault();
            try {
              window.location.assign(
                createEmptyManhuaProject(localStorage, userId, title)
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "创建失败");
            }
          }}
          className="mb-5 flex flex-wrap gap-3"
        >
          <input
            aria-label="新作品名称"
            value={title}
            maxLength={200}
            onChange={e => setTitle(e.target.value)}
            placeholder="新作品名称"
            className="rounded-lg border bg-transparent p-3"
          />
          <button className="rounded-lg bg-amber-200 px-4 py-2 text-black">
            新建作品
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <input
          aria-label="搜索作品"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索作品名称"
          className="mb-5 w-full rounded-lg border bg-transparent p-3"
        />
        {(cloud.isLoading || legacy.isLoading) && <p>正在读取云端作品…</p>}
        {(cloud.isError || legacy.isError) && (
          <p role="alert">
            云端读取失败，本机作品仍保留。
            <button
              onClick={() => {
                void cloud.refetch();
                void legacy.refetch();
              }}
            >
              重试
            </button>
          </p>
        )}
        {cloud.data?.hasMore && (
          <p role="alert">
            作品索引超过本次读取范围，请先按已知作品链接进入；列表尚未全部载入。
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <a href="/canvas" className="rounded-xl border border-white/20 p-5">
            <h2 className="text-xl">
              {legacy.data?.draft?.writerSession.writerPack?.seriesTitle ||
                "原有漫剧作品"}
            </h2>
            <p className="mt-2 text-slate-400">
              保留原有工作区，继续已有制作进度
            </p>
          </a>
          {items.map(p => (
            <a
              key={p.projectId}
              href={`/canvas?project=${p.projectId}&owner=${userId}`}
              className="rounded-xl border border-white/20 p-5"
            >
              <h2 className="text-xl">{p.title}</h2>
              <p className="mt-2 text-slate-400">
                {p.episodeCount}集 · {phase[p.phase] || p.phase}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                {p.updatedAt
                  ? new Date(p.updatedAt).toLocaleString()
                  : "本机草稿"}
              </p>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
