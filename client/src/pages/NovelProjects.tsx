import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { emptyNovelWorkspace, readNovelWorkspace } from "@/lib/novelWorkspace";
import {
  listNovelProjectsDb,
  novelProjectHref,
  readNovelWorkspaceDb,
  saveNovelWorkspaceDb,
  type NovelProjectSummary,
} from "@/lib/novelWorkspaceDb";
import "./CreativeProjects.css";

export default function NovelProjects() {
  const { user, loading } = useAuth();
  if (loading) return <main className="p-8">正在读取账号…</main>;
  if (!user)
    return (
      <main className="p-8">
        <a href="/login">请先登录</a>
      </main>
    );
  if (user.role !== "admin" && user.role !== "supervisor")
    return (
      <main className="p-8">
        小说改编当前仅开放管理者测试。<a href="/">返回首页</a>
      </main>
    );
  return <NovelProjectLibrary key={user.id} userId={String(user.id)} />;
}

export function NovelProjectLibrary({ userId }: { userId: string }) {
  const [local, setLocal] = useState<NovelProjectSummary[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(0);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"source" | "original">("source");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busyRef = useRef(false);
  const cloud = trpc.novelWorkspace.listBackups.useQuery(undefined, {
    retry: 1,
  });
  const backup = trpc.novelWorkspace.backup.useMutation();
  const utils = trpc.useUtils();
  const reload = async () => {
    const result = await listNovelProjectsDb(userId);
    if (alive.current) {
      setLocal(result.projects);
      setUnreadable(result.unreadable);
    }
  };
  useEffect(() => {
    alive.current = true;
    void reload()
      .catch(e => setError(e instanceof Error ? e.message : "本机作品读取失败"))
      .finally(() => setLocalLoading(false));
    return () => {
      alive.current = false;
    };
  }, [userId]);
  const cloudByProject = new Map<
    string,
    NonNullable<typeof cloud.data>[number]
  >();
  for (const item of cloud.data || []) {
    const id = item.projectId || item.roundId;
    const previous = cloudByProject.get(id);
    if (!previous || item.createdAt > previous.createdAt)
      cloudByProject.set(id, item);
  }
  const ids = Array.from(
    new Set([
      ...local.map(p => p.projectId),
      ...Array.from(cloudByProject.keys()),
    ])
  );
  const projects = ids
    .map(id => ({
      id,
      local: local.find(p => p.projectId === id),
      cloud: cloudByProject.get(id),
    }))
    .filter(p =>
      (p.local?.title || p.cloud?.title || "")
        .toLowerCase()
        .includes(search.toLowerCase())
    )
    .sort((a, b) =>
      (b.local?.updatedAt || b.cloud?.createdAt || "").localeCompare(
        a.local?.updatedAt || a.cloud?.createdAt || ""
      )
    );
  const perform = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "操作失败，已有稿件保留");
    } finally {
      busyRef.current = false;
      if (alive.current) {
        setBusy(false);
        await reload().catch(() => {});
      }
    }
  };
  const openCloud = async (item: NonNullable<typeof cloud.data>[number]) => {
    const projectId = item.projectId || item.roundId;
    let before: Awaited<ReturnType<typeof readNovelWorkspaceDb>> | null = null;
    if (local.some(p => p.projectId === projectId)) {
      before = await readNovelWorkspaceDb(userId, projectId);
      if (before.value.pending)
        throw new Error("本机作品有待核对的任务，请先打开本机稿查询原请求。");
      if (
        !window.confirm(
          `打开「${item.title}」的云端保存版本？当前本机稿会先完整备份。`
        )
      )
        return;
      await backup.mutateAsync({ workspaceJson: before.raw! });
    }
    const saved = await utils.novelWorkspace.readBackup.fetch({
      backupId: item.backupId,
    });
    const value = readNovelWorkspace(
      { getItem: () => saved.workspaceJson },
      userId
    ).value;
    if ((value.projectId || value.roundId) !== projectId)
      throw new Error("云端作品身份不一致，未回填");
    await saveNovelWorkspaceDb(
      userId,
      before?.raw || null,
      { ...value, projectId },
      before ? crypto.randomUUID() : undefined,
      projectId
    );
    if (alive.current)
      window.location.assign(novelProjectHref(userId, projectId));
  };
  return (
    <main className="creative-projects" data-novel-projects>
      <div className="creative-projects-inner">
        <nav className="creative-projects-nav">
          <a href="/#image-workshop">← 影像工坊</a>
          <a href="/manhua-projects">我的漫剧</a>
          <a href="/mv-projects">MV 工作流</a>
        </nav>
        <header className="creative-projects-heading">
          <div>
            <span className="creative-projects-eyebrow">故事创作</span>
            <h1>我的小说</h1>
            <p>每部小说独立保存。继续已有故事，或从一本新小说开始。</p>
          </div>
          <span className="creative-projects-count">{ids.length} 部作品</span>
        </header>
        <form
          className="creative-projects-create"
          onSubmit={e => {
            e.preventDefault();
            void perform(async () => {
              if (!title.trim()) throw new Error("请先填写小说名称");
              const value = {
                ...emptyNovelWorkspace(),
                topic: title.trim(),
                mode,
              };
              const id = value.projectId!;
              await saveNovelWorkspaceDb(userId, null, value, undefined, id);
              // 新建后先保存账号内版本；失败时本机作品仍在列表中可继续。
              await backup.mutateAsync({
                workspaceJson: JSON.stringify(value),
              });
              if (alive.current)
                window.location.assign(novelProjectHref(userId, id));
            });
          }}
        >
          <label>
            小说名称
            <input
              aria-label="新小说名称"
              maxLength={200}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="给新故事起个名字"
              disabled={busy}
            />
          </label>
          <label>
            创作方式
            <select
              aria-label="新小说创作方式"
              value={mode}
              onChange={e => setMode(e.target.value as typeof mode)}
              disabled={busy}
            >
              <option value="source">原著改编</option>
              <option value="original">原创小说</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || localLoading || !title.trim()}
          >
            {busy ? "正在保存…" : "新建小说"}
          </button>
        </form>
        <p className="creative-projects-note">
          编辑会自动保存在本机；在工作区点击“保存作品”可保存到当前账号，换设备后从云端版本继续。
        </p>
        {error && (
          <p role="alert" className="creative-projects-error">
            {error}
          </p>
        )}
        {unreadable > 0 && (
          <p role="alert">
            有 {unreadable}{" "}
            份旧稿暂时无法读取，原始数据仍保留；未作为空作品覆盖。
          </p>
        )}
        {cloud.isError && (
          <p role="alert">
            云端列表读取失败，本机稿仍可打开。
            <button disabled={busy} onClick={() => void cloud.refetch()}>
              重试云端
            </button>
          </p>
        )}
        <div className="creative-projects-list-heading">
          <h2>继续创作</h2>
          <input
            aria-label="搜索小说作品"
            placeholder="搜索小说名称"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {(localLoading || cloud.isLoading) && (
          <p role="status">正在读取作品…</p>
        )}
        {!localLoading && !cloud.isLoading && !projects.length && (
          <p className="creative-projects-empty">
            {search
              ? "没有匹配的小说"
              : "还没有小说作品。新建后即可导入原著或开始原创。"}
          </p>
        )}
        <div className="creative-projects-list">
          {projects.map(p => (
            <article className="creative-project-row" key={p.id}>
              <div className="creative-project-copy">
                <h3>{p.local?.title || p.cloud?.title}</h3>
                <p>
                  {p.local
                    ? `${p.local.mode === "source" ? "原著改编" : "原创小说"} · ${p.local.chapterCount} 集正文 · 第 ${p.local.season} 季`
                    : `云端作品 · 第 ${p.cloud?.season || 1} 季`}
                </p>
                <small>
                  {p.local?.pending
                    ? "有原任务待查询 · 打开后核对"
                    : p.cloud
                      ? `云端保存于 ${new Date(p.cloud.createdAt).toLocaleString()}`
                      : "本机已保存 · 尚无云端版本"}
                </small>
              </div>
              <div className="creative-project-actions">
                {p.local && (
                  <a
                    aria-disabled={busy}
                    onClick={e => {
                      if (busy) e.preventDefault();
                    }}
                    href={novelProjectHref(userId, p.id)}
                  >
                    继续本机稿
                  </a>
                )}
                {p.cloud && (
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={() => void perform(() => openCloud(p.cloud!))}
                  >
                    {p.local ? "打开云端稿" : "打开小说"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
