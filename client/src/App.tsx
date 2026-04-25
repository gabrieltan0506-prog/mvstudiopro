import WorkflowStoryboardToVideo from "./pages/WorkflowStoryboardToVideo";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";

// Lazy load pages for performance
const Home = lazy(() => import("./pages/Home"));
const Showcase = lazy(() => import("./pages/Showcase"));
const GrowthCampPage = lazy(() => import("./pages/MVAnalysis"));
const PlatformPage = lazy(() => import("./pages/PlatformPage"));
const VirtualIdol = lazy(() => import("./pages/VirtualIdol"));
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
const SupervisorAccess = lazy(() => import("./pages/SupervisorAccess"));

const ThreeDStudio = lazy(() => import("./pages/ThreeDStudio"));
const MyWorks = lazy(() => import("./pages/MyWorks"));
const AnalysisView = lazy(() => import("./pages/AnalysisView"));

function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
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
        <Route path={"/idol"} component={VirtualIdol} />
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
        <Route path={"/supervisor"} component={SupervisorAccess} />
        <Route path={"/my-works"} component={MyWorks} />
        <Route path={"/my-works/:id"} component={AnalysisView} />
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
  );
}

export default App;
