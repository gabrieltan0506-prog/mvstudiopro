import React, { useEffect, useRef, useState } from "react";
import WorkflowStoryboardToVideo from "./pages/WorkflowStoryboardToVideo";
import TestLab from "./pages/TestLab";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

import UiVersionBadge from "./components/UiVersionBadge";

// Lazy load pages for performance
const Home = lazy(() => import("./pages/Home"));
const Showcase = lazy(() => import("./pages/Showcase"));
const MVAnalysis = lazy(() => import("./pages/MVAnalysis"));
const VirtualIdol = lazy(() => import("./pages/VirtualIdol"));
const Storyboard = lazy(() => import("./pages/Storyboard"));
const VFXEngine = lazy(() => import("./pages/VFXEngine"));
const Pricing = lazy(() => import("./pages/Pricing"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));
const LayoutDashboard = lazy(() => import("./pages/Dashboard"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const PaymentHistory = lazy(() => import("./pages/PaymentHistory"));
const RemixStudio = lazy(() => import("./pages/RemixStudio"));
const WorkspaceStudio = lazy(() => import("./pages/WorkspaceStudio"));
const TemplatesLibrary = lazy(() => import("./pages/TemplatesLibrary"));
const Login = lazy(() => import("./pages/Login"));
const TestLab = lazy(() => import("./pages/TestLab"));

const ThreeDStudio = lazy(() => import("./pages/ThreeDStudio"));

function PageLoader() {
  return (
    
      
    <>
<UiVersionBadge />
<div className="min-h-screen bg-background flex items-center justify-center">
      <KlingCnTestPanel />

      <Loader2 className="h-8 w-8 text-primary animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/showcase"} component={Showcase} />
        <Route path={"/analysis"} component={MVAnalysis} />
        <Route path={"/idol"} component={VirtualIdol} />
        <Route path={"/storyboard"} component={Storyboard} />
        <Route path={"/vfx"} component={VFXEngine} />
        <Route path={"/pricing"} component={Pricing} />
        <Route path={"/team"} component={TeamManagement} />
        <Route path={"/dashboard"} component={LayoutDashboard} />
        <Route path={"/admin"} component={AdminPanel} />
        <Route path={"/payments"} component={PaymentHistory} />
        <Route path={"/remix"} component={RemixStudio} />
        <Route path={"/workspace"} component={WorkspaceStudio} />
        <Route path={"/templates"} component={TemplatesLibrary} />
        <Route path={"/test-lab"} component={TestLab} />
        <Route path={"/login"} component={Login} />

        <Route path={"/3d-studio"} component={ThreeDStudio} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
      </>
);
}

export default App;



/* REMIX_KLING_TEST_PANEL_V1 */
function __sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function KlingCnTestPanel() {
  const [prompt, setPrompt] = useState("电影级动作预告片风格，夜景城市，强对比灯光，稳定镜头");
  const [busy, setBusy] = useState(false);
  const [debug, setDebug] = useState<any>(null);
  const [taskId, setTaskId] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    return () => { stopRef.current = true; };
  }, []);

  async function start() {
    if (busy) return;
    setBusy(true);
    setDebug(null);
    setTaskId("");
    try {
      const cr = await fetch("/api/jobs?op=klingCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, duration: 8 })
      });
      const cj = await cr.json();
      setDebug(cj);

      const tid =
        cj?.json?.taskId || cj?.json?.task_id || cj?.taskId || cj?.task_id ||
        cj?.json?.data?.taskId || cj?.json?.data?.task_id || cj?.data?.taskId || cj?.data?.task_id;

      if (tid) setTaskId(String(tid));
      if (!tid) return;

      const startAt = Date.now();
      while (!stopRef.current) {
        if (Date.now() - startAt > 10 * 60 * 1000) throw new Error("轮询超时（10分钟）");
        const pr = await fetch(`/api/jobs?op=klingTask&taskId=${encodeURIComponent(String(tid))}`);
        const pj = await pr.json();
        setDebug(pj);

        const status = pj?.json?.status || pj?.status || pj?.json?.state || pj?.state;
        const videoUrl = pj?.json?.videoUrl || pj?.json?.video_url || pj?.videoUrl || pj?.video_url;

        if (videoUrl) return;
        if (status && String(status).toLowerCase() in ["failed","error"]) throw new Error("任务失败：" + JSON.stringify(pj));
        await __sleep(2500);
      }
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      marginTop: 16,
      padding: 16,
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(0,0,0,0.25)"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>可灵后端测试（Kling CN）</div>
        {taskId ? <div style={{ fontSize: 12, opacity: 0.8 }}>任务：<code>{taskId}</code></div> : null}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        style={{
          width: "100%",
          marginTop: 10,
          padding: 10,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.25)",
          color: "white"
        }}
      />

      <button
        onClick={start}
        disabled={busy || !prompt.trim()}
        style={{
          marginTop: 10,
          padding: "10px 14px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.18)",
          background: busy ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)",
          color: "white",
          fontWeight: 800,
          cursor: busy ? "not-allowed" : "pointer"
        }}
      >
        {busy ? "生成中…" : "开始生成（8秒）"}
      </button>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>调试输出（JSON）</summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>
          {JSON.stringify(debug, null, 2)}
        </pre>
      </details>
    </div>
  );
}

