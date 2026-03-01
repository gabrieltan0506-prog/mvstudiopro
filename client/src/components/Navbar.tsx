import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { Menu, X, Film, LogOut, User, LayoutDashboard, Shield, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_ITEMS = [
  { label: "视频PK评分", href: "/analysis" },
  { label: "可灵工作室", href: "/remix" },
  { label: "虚拟偶像", href: "/idol" },
  { label: "2D转3D", href: "/3d-studio" },
  { label: "分镜脚本", href: "/storyboard" },
  { label: "分镜转视频", href: "/vfx" },
  { label: "爆款展厅", href: "/showcase" },
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
        <div className="hidden lg:flex items-center gap-0.5">
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

        {/* Auth */}
        <div className="hidden lg:flex items-center gap-3 shrink-0">
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
                <DropdownMenuItem onClick={() => navigate("/team")}>
                  <User className="mr-2 h-4 w-4" />
                  团队管理
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
                  登出
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

        {/* Mobile Toggle */}
        <button
          className="lg:hidden p-2 text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl max-h-[70vh] overflow-y-auto">
          <div className="container py-4 space-y-1">
            <Link
              href="/"
              className={`block px-4 py-2.5 rounded-md text-sm font-medium no-underline ${
                location === "/" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMobileOpen(false)}
            >
              首页
            </Link>
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-4 py-2.5 rounded-md text-sm font-medium no-underline ${
                  location === item.href
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            {isAuthenticated && (
              <div className="pt-2 mt-2 border-t border-border/50 space-y-1">
                <Link href="/dashboard" className="block px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground no-underline" onClick={() => setMobileOpen(false)}>
                  个人中心
                </Link>
                <Link href="/team" className="block px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground no-underline" onClick={() => setMobileOpen(false)}>
                  团队管理
                </Link>
                {user?.role === "admin" && (
                  <Link href="/admin" className="block px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground no-underline" onClick={() => setMobileOpen(false)}>
                    管理后台
                  </Link>
                )}
              </div>
            )}
            <div className="pt-2 border-t border-border/50">
              {isAuthenticated ? (
                <button
                  className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:text-red-300"
                  onClick={() => { logout(); setMobileOpen(false); }}
                >
                  登出
                </button>
              ) : (
                <Button
                  size="sm"
                  className="w-full bg-primary text-primary-foreground"
                  onClick={() => { window.location.href = getLoginUrl(); }}
                >
                  登录
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
