import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Battery } from "lucide-react";
import { toast } from "sonner";

export default function AcceptInvitation() {
  const [, params] = useRoute<{ token: string }>("/convite/:token");
  const [, setLocation] = useLocation();
  const token = params?.token ?? "";

  const inspect = trpc.invitations.inspect.useQuery({ token }, { enabled: !!token, retry: false });
  const utils = trpc.useUtils();

  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });

  const consume = trpc.invitations.consume.useMutation({
    onSuccess: () => {
      toast.success("Conta criada! Redirecionando…");
      utils.auth.me.invalidate();
      setTimeout(() => setLocation("/"), 600);
    },
    onError: (e) => toast.error(e.message),
  });

  if (inspect.isLoading) {
    return <CenteredLayout><p className="text-sm text-muted-foreground">Validando convite…</p></CenteredLayout>;
  }

  if (!inspect.data || !inspect.data.valid) {
    return (
      <CenteredLayout>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-6">
            <h1 className="text-lg font-semibold text-red-300 mb-2">Convite inválido</h1>
            <p className="text-sm text-muted-foreground">
              {inspect.data?.reason ?? "Este link não pode ser usado."}
            </p>
            <Button className="mt-4" onClick={() => setLocation("/login")}>Ir para o login</Button>
          </CardContent>
        </Card>
      </CenteredLayout>
    );
  }

  const role = inspect.data.role;
  const passwordsMatch = form.password === form.confirm && form.password.length >= 8;
  const canSubmit = form.name.trim().length > 0 && /\S+@\S+\.\S+/.test(form.email) && passwordsMatch;

  return (
    <CenteredLayout>
      <Card className="border-white/5">
        <CardContent className="p-6 space-y-4">
          {/* Logomarca centralizada */}
          <div className="flex justify-center">
            <img
              src="/logo-full.png"
              alt="Gama Solar"
              className="h-12 object-contain"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.nextElementSibling?.classList.remove("hidden");
              }}
            />
            <div className="hidden w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Battery className="w-5 h-5 text-primary" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg font-bold">Bem-vindo à Gama Solar</h1>
              <p className="text-xs text-muted-foreground">Complete seu cadastro</p>
            </div>
            <Badge className={`ml-auto ${role === "admin" ? "bg-blue-500/15 text-blue-300" : "bg-zinc-500/15 text-zinc-300"}`}>
              {role === "admin" ? "ADMIN" : "USUÁRIO"}
            </Badge>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="name">Nome completo</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.toLowerCase() })} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="pwd">Senha (mínimo 8 caracteres)</Label>
              <Input id="pwd" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="pwd2">Confirmar senha</Label>
              <Input id="pwd2" type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} className="mt-1.5" />
              {form.confirm.length > 0 && !passwordsMatch && (
                <p className="text-xs text-red-400 mt-1">As senhas não coincidem ou são curtas demais.</p>
              )}
            </div>
          </div>

          <Button
            className="w-full"
            disabled={!canSubmit || consume.isPending}
            onClick={() => consume.mutate({ token, name: form.name, email: form.email, password: form.password })}
          >
            {consume.isPending ? "Criando conta…" : "Criar conta"}
          </Button>
        </CardContent>
      </Card>
    </CenteredLayout>
  );
}

function CenteredLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
