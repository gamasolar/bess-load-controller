import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Battery, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

type AuthMode = "login" | "register";

type AuthStatusResponse = {
  hasUsers: boolean;
  signupAllowed: boolean;
};

async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  const res = await fetch("/api/auth/status", { credentials: "include" });
  if (!res.ok) {
    return { hasUsers: true, signupAllowed: false };
  }
  return (await res.json()) as AuthStatusResponse;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signupAllowed, setSignupAllowed] = useState(true);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);

  // On mount: query the server to know whether the system already has users.
  // If not, we are in "first run / create admin" mode and force the register tab.
  useEffect(() => {
    let cancelled = false;
    fetchAuthStatus()
      .then((status) => {
        if (cancelled) return;
        setHasUsers(status.hasUsers);
        setSignupAllowed(status.signupAllowed);
        if (!status.hasUsers) {
          setMode("register");
          setInfo(
            "Nenhum usuário cadastrado ainda. Crie a conta de administrador inicial.",
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setHasUsers(true);
        setSignupAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email: email.trim(), password }
          : { email: email.trim(), password, name: name.trim() };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      let payload: { error?: string; success?: boolean } = {};
      try {
        payload = await res.json();
      } catch {
        /* ignore body parse error */
      }

      if (!res.ok || !payload.success) {
        setError(payload.error ?? "Falha na autenticação. Tente novamente.");
        return;
      }

      // Refresh the auth.me query so the rest of the app picks up the new session.
      await utils.auth.me.invalidate();
      setLocation("/");
    } catch (e) {
      console.error("[Login] submit failed:", e);
      setError("Não foi possível contactar o servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  const canSwitchToRegister = signupAllowed || hasUsers === false;

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Battery className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">BESS Controller</CardTitle>
              <CardDescription>Sistema de Gerenciamento de Baterias</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {info && (
            <Alert className="mb-4">
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                  autoComplete="name"
                  disabled={submitting}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@exemplo.com"
                autoComplete="email"
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={mode === "register" ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "Mínimo 8 caracteres" : "••••••••"}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                disabled={submitting}
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              canSwitchToRegister ? (
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className="text-primary hover:underline"
                  disabled={submitting}
                >
                  Não tem conta? Cadastre-se
                </button>
              ) : (
                <span>O cadastro de novos usuários está desabilitado.</span>
              )
            ) : (
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="text-primary hover:underline"
                disabled={submitting}
              >
                Já tem conta? Faça login
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
