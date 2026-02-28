import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

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

const ThreeDStudio = lazy(() => import("./pages/ThreeDStudio"));

function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
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
