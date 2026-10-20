import { lazy, Suspense, useEffect, useState } from "react";
import {
  Camera,
  Clapperboard,
  Music2,
  ArrowUpRight,
  Image,
} from "lucide-react";
import HomePhotoTools from "./HomePhotoTools";

const HomeCoverWorkshop = lazy(() => import("./HomeCoverWorkshop"));

const workflows = [
  { id: "cover", title: "封面", detail: "三款初稿 · 选定精修", icon: Image },
  { id: "photo", title: "照片", detail: "修复 · 放大 · 动起来", icon: Camera },
  {
    id: "manhua",
    title: "漫剧",
    detail: "小说 · 剧本 · 连载成片",
    icon: Clapperboard,
  },
  { id: "mv", title: "MV", detail: "歌曲 · 镜头 · 剪辑成片", icon: Music2 },
] as const;

export default function HomeImageWorkshop() {
  const [tab, setTab] = useState<(typeof workflows)[number]["id"]>("cover");
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#photo-tools")) setTab("photo");
      if (window.location.hash.startsWith("#cover-design")) setTab("cover");
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const linkClass =
    "inline-flex min-h-12 items-center justify-center gap-3 rounded-xl border border-[var(--hp-accent-line)] bg-[var(--hp-accent)] px-6 py-3 text-base font-bold text-white transition hover:opacity-90";
  return (
    <section
      id="image-workshop"
      className="mx-auto w-full max-w-[1120px] scroll-mt-24 px-5 py-20"
    >
      <header className="max-w-3xl">
        <p className="text-xs font-bold tracking-[0.18em] text-[var(--hp-accent)]">
          创作从这里开始
        </p>
        <h2 className="mt-4 text-4xl font-black tracking-tight text-[var(--hp-ink)] sm:text-5xl">
          影像工坊
        </h2>
        <p className="mt-5 text-base leading-8 text-[var(--hp-muted)]">
          一张封面、一张照片、一个故事，或一首歌。选择你的创作方式，接着把作品做完。
        </p>
      </header>
      <div
        className="mt-9 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4"
        role="tablist"
        aria-label="影像工坊创作类型"
      >
        {workflows.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`workshop-tab-${item.id}`}
            aria-controls={`workshop-panel-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onKeyDown={event => {
              const index = workflows.findIndex(w => w.id === item.id);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % workflows.length
                  : event.key === "ArrowLeft"
                    ? (index + workflows.length - 1) % workflows.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? workflows.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setTab(workflows[next].id);
              document
                .getElementById(`workshop-tab-${workflows[next].id}`)
                ?.focus();
            }}
            onClick={() => setTab(item.id)}
            className={`min-w-0 rounded-2xl border p-3 text-left transition sm:p-5 ${tab === item.id ? "border-[var(--hp-accent)] bg-[var(--hp-accent-soft)]" : "border-[var(--hp-line)] bg-[var(--hp-card)] hover:border-[var(--hp-accent-line)]"}`}
          >
            <item.icon className="mb-3 h-5 w-5 text-[var(--hp-accent)]" />
            <span className="block text-lg font-bold text-[var(--hp-ink)] sm:text-xl">
              {item.title}
            </span>
            <span className="mt-2 block text-xs leading-6 text-[var(--hp-muted)] sm:text-sm">
              {item.detail}
            </span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="workshop-panel-cover"
        aria-labelledby="workshop-tab-cover"
        hidden={tab !== "cover"}
      >
        <Suspense fallback={<p className="mt-7">正在打开封面工坊…</p>}>
          <HomeCoverWorkshop />
        </Suspense>
      </div>
      <div
        role="tabpanel"
        id="workshop-panel-photo"
        aria-labelledby="workshop-tab-photo"
        hidden={tab !== "photo"}
      >
        <p className="mt-7 text-sm leading-7 text-[var(--hp-muted)]">
          上传照片，选择高清放大、修复上色或照片动起来；三个工具可以独立使用。
        </p>
        <HomePhotoTools embedded />
      </div>
      <div
        role="tabpanel"
        id="workshop-panel-manhua"
        aria-labelledby="workshop-tab-manhua"
        hidden={tab !== "manhua"}
      >
        <div className="mt-7 rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-6 sm:p-9">
          <p className="text-sm font-semibold text-[var(--hp-accent)]">
            把故事拍出来
          </p>
          <h3 className="mt-3 text-2xl font-bold text-[var(--hp-ink)]">
            从小说改编到漫剧制作
          </h3>
          <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--hp-muted)]">
            每部作品独立保存。先创作或改编小说，确认剧本后接入漫剧工厂；也可以直接打开已有漫剧继续制作。
          </p>
          <p className="my-6 text-sm leading-7 text-[var(--hp-muted)]">
            剧本确认 → 角色与场景 → 分镜与镜头 → 剪辑成片
          </p>
          <div className="flex flex-wrap gap-3">
            <a className={linkClass} href="/manhua-projects">
              进入漫剧工作流 <ArrowUpRight size={18} />
            </a>
            <a
              className={`${linkClass} !bg-transparent !text-[var(--hp-accent)]`}
              href="/novel-projects"
            >
              我的小说 · 新建与改编
            </a>
          </div>
        </div>
      </div>
      <div
        role="tabpanel"
        id="workshop-panel-mv"
        aria-labelledby="workshop-tab-mv"
        hidden={tab !== "mv"}
      >
        <div className="mt-7 rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-6 sm:p-9">
          <p className="text-sm font-semibold text-[var(--hp-accent)]">
            让音乐拥有画面
          </p>
          <h3 className="mt-3 text-2xl font-bold text-[var(--hp-ink)]">
            从一首歌开始制作 MV
          </h3>
          <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--hp-muted)]">
            上传自己的歌曲，或创作一首新歌。与顾问确定视觉方案，再逐镜制作、剪辑并合成完整作品。
          </p>
          <p className="my-6 text-sm leading-7 text-[var(--hp-muted)]">
            选定歌曲 → 视觉方案 → 分镜 → 镜头制作 → 剪辑合成
          </p>
          <a className={linkClass} href="/mv-projects">
            进入 MV 工作流 <ArrowUpRight size={18} />
          </a>
        </div>
      </div>
    </section>
  );
}
