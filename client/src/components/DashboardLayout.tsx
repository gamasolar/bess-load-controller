import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { LOGIN_PATH } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Zap,
  Battery,
  Settings,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

const baseMenu = [
  { icon: LayoutDashboard, label: "Visão Geral", path: "/" },
];
const adminMenu = [
  { icon: Settings, label: "Configurações", path: "/configuracoes" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width-v2";
const DEFAULT_WIDTH = 200;
const MIN_WIDTH = 180;
const MAX_WIDTH = 400;

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 3).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function getFirstLastName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Battery className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">BESS Controller</h1>
                <p className="text-xs text-muted-foreground">Sistema de Gerenciamento de Baterias</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground text-center max-w-sm mt-4">
              Acesse o painel de controle para monitorar e gerenciar os sistemas BESS.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = LOGIN_PATH;
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            <Zap className="w-4 h-4 mr-2" />
            Entrar no Sistema
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout, isAdmin } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuItems = isAdmin ? [...baseMenu, ...adminMenu] : baseMenu;
  const activeMenuItem = menuItems.find((item) => item.path === location);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft =
        sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-20 relative justify-center pt-1">
            {/* Botão minimizar — fixado no canto superior direito */}
            <button
              onClick={toggleSidebar}
              className="absolute top-1.5 right-1.5 h-6 w-6 flex items-center justify-center hover:bg-accent rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring z-10"
              aria-label={isCollapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
              title={isCollapsed ? "Expandir" : "Recolher"}
            >
              <PanelLeft className="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            <div className="flex items-center gap-1.5 px-2 w-full">
              <img
                src="/logo.png"
                alt="Gama Solar"
                className="h-10 object-contain shrink-0"
              />

              {!isCollapsed && (
                <div className="flex flex-col leading-none items-end shrink-0">
                  <span className="font-bold tracking-tight text-sm">GAMA SOLAR</span>
                  <span className="text-[9px] uppercase tracking-[0.28em] text-muted-foreground mt-0.5">BESS</span>
                </div>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            {/* Main navigation */}
            <SidebarMenu className="px-2 py-1">
              {menuItems.map((item) => {
                const isActive =
                  item.path === "/"
                    ? location === "/"
                    : location.startsWith(item.path);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-10 transition-all font-normal"
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && !isCollapsed && (
                        <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {item.badge}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>

          </SidebarContent>

          <SidebarFooter className="p-3 gap-2">
            <DropdownMenu>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex items-center gap-2 rounded-md hover:bg-accent/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring px-1 py-1 w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                        aria-label={`Conta — ${user?.name || ""}`}
                      >
                        <Avatar className="h-9 w-9 border shrink-0">
                          {(user as { avatarUrl?: string | null })?.avatarUrl && (
                            <AvatarImage src={(user as { avatarUrl?: string | null }).avatarUrl ?? undefined} alt={user?.name ?? ""} />
                          )}
                          <AvatarFallback className="text-[11px] font-semibold tracking-wider bg-primary/10 text-primary">
                            {getInitials(user?.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium truncate text-left flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                          {getFirstLastName(user?.name)}
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="end" className="max-w-[240px]">
                    <p className="font-medium">{user?.name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{user?.email || ""}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <DropdownMenuContent align="end" side="right" className="w-56">
                <div className="px-2 py-2 border-b border-white/5 mb-1">
                  <p className="text-sm font-medium truncate">{user?.name || "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
                </div>
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!isCollapsed && (
              <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span>Sistema operacional</span>
              </div>
            )}
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <Battery className="h-4 w-4 text-primary" />
                <span className="tracking-tight text-foreground text-sm font-medium">
                  {activeMenuItem?.label ?? "BESS Controller"}
                </span>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
