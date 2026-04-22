import React, { useCallback } from "react";

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";

function grantSupervisorAccess() {
  localStorage.setItem(SUPERVISOR_ACCESS_KEY, "1");
}

function clearSupervisorAccess() {
  localStorage.removeItem(SUPERVISOR_ACCESS_KEY);
}

export default function SupervisorAccess() {
  const enterPath = useCallback((path: string) => {
    grantSupervisorAccess();
    window.location.href = path;
  }, []);

  return (
    <div className="min-h-screen bg-[#08111f] text-[#f7f4ef]">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,138,61,0.22),transparent_32%),linear-gradient(180deg,#101d31_0%,#08111f_78%)] p-8 md:p-10">
          <div className="inline-flex rounded-full border border-[#ff8a3d]/25 bg-[#ff8a3d]/10 px-3 py-1 text-xs font-semibold tracking-[0.24em] text-[#ffb37f]">
            SUPERVISOR ACCESS
          </div>
          <h1 className="mt-5 text-4xl font-black leading-tight md:text-6xl">
            免登录监督入口
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-white/70">
            这个入口会在浏览器写入本地 supervisor 标记，只用于当前设备的免登录验收和巡检，不会创建正式用户会话。
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                title: "创作商业成长营",
                desc: "直接进入成长营主页面，不跳登录。",
                path: "/creator-growth-camp",
              },
              {
                title: "分镜工作流",
                desc: "进入旧版 workflow 继续验收流程。",
                path: "/workflow",
              },
              {
                title: "节点工作流",
                desc: "进入 workflow-nodes 验收迁移界面。",
                path: "/workflow-nodes",
              },
            ].map((item) => (
              <button
                key={item.path}
                onClick={() => enterPath(item.path)}
                className="rounded-[24px] border border-white/10 bg-black/20 p-5 text-left transition hover:bg-white/10"
              >
                <div className="text-xl font-bold text-white">{item.title}</div>
                <p className="mt-3 text-sm leading-7 text-white/65">{item.desc}</p>
                <div className="mt-5 inline-flex rounded-full border border-[#ff8a3d]/20 bg-[#ff8a3d]/10 px-3 py-1 text-xs font-semibold text-[#ffd4b7]">
                  进入
                </div>
              </button>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={() => {
                clearSupervisorAccess();
                window.location.href = "/";
              }}
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10"
            >
              清除 supervisor 标记
            </button>
            <a
              href="/"
              className="rounded-2xl border border-white/10 bg-black/20 px-5 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10"
            >
              返回首页
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
