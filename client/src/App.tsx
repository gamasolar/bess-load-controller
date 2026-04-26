import { Route, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import DashboardLayout from "@/components/DashboardLayout";
import Home from "@/pages/Home";
import Login from "@/pages/Login";

export default function App() {
  const [location] = useLocation();

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
          <Route path="/" component={Home} />
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
