import { Route, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import DashboardLayout from "@/components/DashboardLayout";
import Overview from "@/pages/Overview";
import SiteDashboard from "@/pages/SiteDashboard";
import History from "@/pages/History";
import SystemInfo from "@/pages/SystemInfo";
import Reports from "@/pages/Reports";
import Login from "@/pages/Login";

export default function App() {
  const [location] = useLocation();

  // The login page must render outside the DashboardLayout (no sidebar, no auth gate),
  // otherwise the layout would redirect the user away from the login form.
  if (location === "/login") {
    return (
      <ThemeProvider defaultTheme="dark">
        <Login />
        <Toaster />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark">
      <DashboardLayout>
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/site/:slug" component={SiteDashboard} />
          <Route path="/historico" component={History} />
          <Route path="/relatorios" component={Reports} />
          <Route path="/sistema" component={SystemInfo} />
          <Route>
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Página não encontrada</p>
            </div>
          </Route>
        </Switch>
      </DashboardLayout>
      <Toaster />
    </ThemeProvider>
  );
}
