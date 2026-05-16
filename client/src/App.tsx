import WorkflowStoryboardToVideo from "./pages/WorkflowStoryboardToVideo";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AmbientSceneProvider } from "@/components/AmbientSceneProvider";
import GlobalAmbientBackdrop from "@/components/GlobalAmbientBackdrop";
import { PWAInstallButton } from "@/components/PWAInstallButton";
import { useAuth } from "@/_core/hooks/useAuth";

import { captureSupervisorTokenFromUrl } from "@/lib/supervisorTrpcToken";

function DomainRedirector() {
  const { user, loading } = useAuth();
  
  useEffect(() => {
    captureSupervisorTokenFromUrl();
    
    if (loading) return;
    
    const hostname = window.location.hostname;
    // 如果訪問的是 fly.dev 測試域名
    if (hostname.endsWith("mvstudiopro.fly.dev")) {
      // 豁免 /login，讓管理員有機會在此域名登入取得權限
      if (window.location.pathname.startsWith("/login")) {
        return;
      }
      
      // 豁免 ?supervisor=1 帶有 token 的請求，讓管理員直接使用免登入 URL
      if (window.location.search.includes("supervisor=1")) {
        return;
      }
      
      const isAdmin = user?.role === "admin" || user?.role === "supervisor";
      
      // 非管理員一律跳轉至正式 Vercel 域名
      if (!isAdmin) {
        const targetUrl = `https://mvstudiopro.com${window.location.pathname}${window.location.search}`;
        window.location.replace(targetUrl);
      }
    } else {
      // 處理 mvstudiopro.com 正式域名下的 supervisor=1 的跳轉
      if (window.location.search.includes("supervisor=1") && !window.location.hostname.includes("localhost")) {
        // 可以加上其它特定的業務邏輯，但目前需求是保證 supervisor=1 也有效
        // 因不涉及跨域跳轉，不需特別處理，它原本就有效
      }
    }
  }, [user, loading]);

  return null;
}

// Lazy load pages for performance
const Home = lazy(() => import("./pages/Home"));
const Showcase = lazy(() => import("./pages/Showcase"));
const GrowthCampPage = lazy(() => import("./pages/MVAnalysis"));
const PlatformPage = lazy(() => import("./pages/PlatformPage"));
const Storyboard = lazy(() => import("./pages/Storyboard"));
const VFXEngine = lazy(() => import("./pages/VFXEngine"));
const Pricing = lazy(() => import("./pages/Pricing"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));
const LayoutDashboard = lazy(() => import("./pages/Dashboard"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const PaymentHistory = lazy(() => import("./pages/PaymentHistory"));
const RemixStudio = lazy(() => import("./pages/RemixStudio"));
const RemixLanding = lazy(() => import("./pages/RemixLanding"));
const WorkspaceStudio = lazy(() => import("./pages/WorkspaceStudio"));
const TemplatesLibrary = lazy(() => import("./pages/TemplatesLibrary"));
const Login = lazy(() => import("./pages/Login"));
const TestLab = lazy(() => import("./pages/TestLab"));
const WorkflowNodes = lazy(() => import("./pages/WorkflowNodes"));
const CreativePage = lazy(() => import("./pages/CreativePage"));
const SupervisorAccess = lazy(() => import("./pages/SupervisorAccess"));

const MyWorks = lazy(() => import("./pages/MyWorks"));
const AnalysisView = lazy(() => import("./pages/AnalysisView"));
const ResearchPage = lazy(() => import("./pages/ResearchPage"));
const GodViewPage = lazy(() => import("./pages/GodViewPage"));
const MyReportsPage = lazy(() => import("./pages/MyReportsPage"));
const SupervisorDeepResearchPage = lazy(() => import("./pages/SupervisorDeepResearchPage"));
const PlatformIpMatrixPage = lazy(() => import("./pages/PlatformIpMatrixPage"));
const CompetitorRadarPage = lazy(() => import("./pages/CompetitorRadarPage"));
const VipTrackerPage = lazy(() => import("./pages/VipTrackerPage"));
const EnterpriseAgentManager = lazy(() => import("./pages/EnterpriseAgentManager"));
const EnterpriseAgentDetail = lazy(() => import("./pages/EnterpriseAgentDetail"));
const EnterpriseAgentPlayground = lazy(() => import("./pages/EnterpriseAgentPlayground"));

function PageLoader() {
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 text-primary animate-spin" />
    </div>
  );
}

function LegacyRemixRedirect() {
  const [, navigate] = useLocation();

  useEffect(() => {
    navigate("/kling-studio", { replace: true });
  }, [navigate]);

  return <PageLoader />;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/showcase"} component={Showcase} />
        <Route path={"/analysis"} component={GrowthCampPage} />
        <Route path={"/viral"} component={GrowthCampPage} />
        <Route path={"/creator-growth-camp"} component={GrowthCampPage} />
        <Route path={"/platform"} component={PlatformPage} />
        <Route path={"/creator-growth-camp/platform"} component={PlatformPage} />
        <Route path={"/creator-growth-camp/premium-remix"} component={RemixLanding} />
        <Route path={"/storyboard"} component={Storyboard} />
        <Route path={"/vfx"} component={VFXEngine} />
        <Route path={"/pricing"} component={Pricing} />
        <Route path={"/team"} component={TeamManagement} />
        <Route path={"/dashboard"} component={LayoutDashboard} />
        <Route path={"/admin"} component={AdminPanel} />
        <Route path={"/payments"} component={PaymentHistory} />
        <Route path={"/kling-studio"} component={RemixStudio} />
        <Route path={"/remix"} component={LegacyRemixRedirect} />
        <Route path={"/workflow"} component={WorkflowStoryboardToVideo} />
        <Route path={"/workspace"} component={WorkspaceStudio} />
        <Route path={"/templates"} component={TemplatesLibrary} />
        <Route path={"/test-lab"} component={TestLab} />
        <Route path={"/workflow-nodes"} component={WorkflowNodes} />
        <Route path={"/creative"} component={CreativePage} />
        <Route path={"/supervisor"} component={SupervisorAccess} />
        <Route path={"/my-works"} component={MyWorks} />
        <Route path={"/my-works/:id"} component={AnalysisView} />
        <Route path={"/research"} component={ResearchPage} />
        <Route path={"/god-view"} component={GodViewPage} />
        <Route path={"/my-reports"} component={MyReportsPage} />
        <Route path={"/supervisor/deep-research"} component={SupervisorDeepResearchPage} />
        <Route path={"/agent/platform-ip-matrix"} component={PlatformIpMatrixPage} />
        <Route path={"/agent/competitor-radar"} component={CompetitorRadarPage} />
        <Route path={"/agent/vip-tracker"} component={VipTrackerPage} />
        <Route path={"/enterprise-agent"} component={EnterpriseAgentManager} />
        <Route path={"/enterprise-agent/:agentId"} component={EnterpriseAgentDetail} />
        <Route path={"/enterprise-agent/:agentId/play"} component={EnterpriseAgentPlayground} />
        <Route path={"/login"} component={Login} />

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
          <AmbientSceneProvider>
            <DomainRedirector />
            <GlobalAmbientBackdrop />
            <div className="relative z-[1] min-h-dvh">
              <Toaster />
              <PWAInstallButton />
              <Router />
            </div>
          </AmbientSceneProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
