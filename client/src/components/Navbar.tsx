import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { Menu, Film, LogOut, User, LayoutDashboard, Shield, ChevronDown, FolderOpen, Briefcase } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const NAV_ITEMS = [
  { label: "创作画布", href: "/workflow-nodes" },
  { label: "创作者成长营", href: "/creator-growth-camp" },
  { label: "企业 Agent", href: "/enterprise-agent" },
  { label: "套餐", href: "/pricing" },
];

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const [location, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const showTestLab = import.meta.env.DEV || user?.role === "admin";
  const navItems = showTestLab
    ? [...NAV_ITEMS, { label: "测试台", href: "/test-lab" }]
    : NAV_ITEMS;

  // 路由切换时自动关闭移动菜单（处理浏览器前进/后退、外部跳转回来等场景）
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 no-underline shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Film className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">
            MV Studio <span className="text-primary">Pro</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden xl:flex items-center gap-0.5">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 no-underline hover:scale-[1.05] active:scale-[0.97] ${
                location === item.href
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {/* Auth (desktop) */}
        <div className="hidden xl:flex items-center gap-3 shrink-0">
          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <User className="h-4 w-4" />
                  <span className="max-w-[140px] truncate">{user.email || user.name || "用户"}</span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  个人中心
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/my-works")}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  我的作品
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/team")}>
                  <User className="mr-2 h-4 w-4" />
                  团队管理
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/enterprise-agent")}>
                  <Briefcase className="mr-2 h-4 w-4" />
                  我的企业 Agent
                </DropdownMenuItem>
                {user.role === "admin" && (
                  <DropdownMenuItem onClick={() => navigate("/admin")}>
                    <Shield className="mr-2 h-4 w-4" />
                    管理后台
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()}>
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              size="sm"
              onClick={() => { window.location.href = getLoginUrl(); }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              登录
            </Button>
          )}
        </div>

        {/* Mobile trigger */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
              aria-expanded={mobileOpen}
              className="xl:hidden inline-flex items-center justify-center min-h-11 min-w-11 rounded-md text-foreground hover:bg-accent active:scale-95 transition"
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] sm:max-w-sm flex flex-col p-0">
            <SheetTitle className="sr-only">主菜单</SheetTitle>
            <SheetDescription className="sr-only">站点导航与用户操作</SheetDescription>

            {/* Mobile menu header */}
            <div className="flex items-center gap-2.5 px-5 pt-5 pb-3 border-b border-border/50">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                <Film className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-base font-bold tracking-tight text-foreground">
                MV Studio <span className="text-primary">Pro</span>
              </span>
            </div>

            {/* Nav links */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              <Link
                href="/"
                className={`block px-4 py-3 rounded-md text-sm font-medium no-underline min-h-11 ${
                  location === "/" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
                onClick={closeMobile}
              >
                首页
              </Link>
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-4 py-3 rounded-md text-sm font-medium no-underline min-h-11 ${
                    location === item.href
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                  onClick={closeMobile}
                >
                  {item.label}
                </Link>
              ))}

              {isAuthenticated && (
                <div className="pt-3 mt-3 border-t border-border/50 space-y-1">
                  <Link
                    href="/dashboard"
                    className="flex items-center gap-2 px-4 py-3 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent no-underline min-h-11"
                    onClick={closeMobile}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    个人中心
                  </Link>
                  <Link
                    href="/my-works"
                    className="flex items-center gap-2 px-4 py-3 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent no-underline min-h-11"
                    onClick={closeMobile}
                  >
                    <FolderOpen className="h-4 w-4" />
                    我的作品
                  </Link>
                  <Link
                    href="/team"
                    className="flex items-center gap-2 px-4 py-3 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent no-underline min-h-11"
                    onClick={closeMobile}
                  >
                    <User className="h-4 w-4" />
                    团队管理
                  </Link>
                  <Link
                    href="/enterprise-agent"
                    className="flex items-center gap-2 px-4 py-3 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent no-underline min-h-11"
                    onClick={closeMobile}
                  >
                    <Briefcase className="h-4 w-4" />
                    我的企业 Agent
                  </Link>
                  {user?.role === "admin" && (
                    <Link
                      href="/admin"
                      className="flex items-center gap-2 px-4 py-3 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent no-underline min-h-11"
                      onClick={closeMobile}
                    >
                      <Shield className="h-4 w-4" />
                      管理后台
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* Footer auth action */}
            <div className="px-4 py-4 border-t border-border/50">
              {isAuthenticated ? (
                <Button
                  variant="ghost"
                  className="w-full justify-start min-h-11 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                  onClick={() => { logout(); closeMobile(); }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="w-full min-h-11 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => { window.location.href = getLoginUrl(); }}
                >
                  登录
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
