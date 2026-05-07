import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, KeyRound, UserPlus, Power, Pencil, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

type Role = "user" | "admin";
type UserRow = {
  id: number; openId: string; name: string | null; email: string | null;
  role: Role; disabled: boolean; avatarUrl?: string | null;
  createdAt: Date | string; lastSignedIn: Date | string;
};

function userInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 3).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function fmt(t: Date | string | null | undefined): string {
  if (!t) return "—";
  return new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/convite/${token}`;
}

function defaultExpiryDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function CreateInvite() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>("user");
  const [expiryDate, setExpiryDate] = useState(defaultExpiryDate());
  const [unlimited, setUnlimited] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);

  const create = trpc.invitations.create.useMutation({
    onSuccess: (res) => {
      setGenerated(res.token);
      utils.invitations.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const reset = () => {
    setRole("user"); setExpiryDate(defaultExpiryDate()); setUnlimited(false); setGenerated(null);
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  const url = generated ? inviteUrl(generated) : "";

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <UserPlus className="w-4 h-4" /> Gerar convite
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gerar link de convite</DialogTitle>
            <DialogDescription>
              O destinatário define a própria senha. O link tem uso único e expira após o prazo.
            </DialogDescription>
          </DialogHeader>

          {!generated ? (
            <div className="space-y-4">
              <div>
                <Label>Papel</Label>
                <div className="flex gap-2 mt-1.5">
                  <Button variant={role === "user" ? "default" : "outline"} size="sm" onClick={() => setRole("user")}>
                    Usuário
                  </Button>
                  <Button variant={role === "admin" ? "default" : "outline"} size="sm" onClick={() => setRole("admin")}>
                    Admin
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {role === "admin"
                    ? "Pode editar configurações, controlar bombas, gerenciar usuários."
                    : "Somente leitura: visualiza estado e histórico."}
                </p>
              </div>
              <div>
                <Label htmlFor="expiry">Expira em</Label>
                <Input
                  id="expiry"
                  type="date"
                  min={todayIso}
                  value={expiryDate}
                  disabled={unlimited}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="mt-1.5"
                />
                <label className="flex items-center gap-2 mt-2 text-sm">
                  <input
                    type="checkbox"
                    checked={unlimited}
                    onChange={(e) => setUnlimited(e.target.checked)}
                  />
                  Sem expiração
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">Link gerado. Copie e envie ao destinatário:</p>
              <div className="flex gap-2">
                <Input readOnly value={url} className="font-mono text-xs" />
                <Button
                  variant="outline" size="icon"
                  onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copiado!"); }}
                  aria-label="Copiar"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Após o cadastro, este link não pode ser reusado. Para outro convite, gere um novo.
              </p>
            </div>
          )}

          <DialogFooter>
            {!generated ? (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>Cancelar</Button>
                <Button
                  onClick={() => create.mutate({
                    role,
                    expiresAt: unlimited
                      ? null
                      : new Date(`${expiryDate}T23:59:59`).toISOString(),
                  })}
                  disabled={create.isPending || (!unlimited && !expiryDate)}
                >
                  {create.isPending ? "Gerando…" : "Gerar"}
                </Button>
              </>
            ) : (
              <Button onClick={() => { setOpen(false); reset(); }}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AvatarUploader({ user, onChanged }: { user: UserRow; onChanged: (url: string | null) => void }) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(user.avatarUrl ?? null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione uma imagem (JPG, PNG ou WebP)");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Imagem excede 25 MB");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/users/${user.id}/avatar`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha no upload");
      setPreview(json.avatarUrl);
      onChanged(json.avatarUrl);
      utils.users.list.invalidate();
      utils.auth.me.invalidate();
      toast.success("Avatar atualizado");
    } catch (e: any) {
      toast.error(e.message ?? "Falha no upload");
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}/avatar`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao remover");
      setPreview(null);
      onChanged(null);
      utils.users.list.invalidate();
      utils.auth.me.invalidate();
      toast.success("Avatar removido");
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao remover");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-16 w-16 border">
        {preview && <AvatarImage src={preview} alt={user.name ?? ""} />}
        <AvatarFallback className="text-base font-semibold tracking-wider bg-primary/10 text-primary">
          {userInitials(user.name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()} className="gap-1.5">
            <Upload className="w-3.5 h-3.5" /> {preview ? "Trocar" : "Enviar"}
          </Button>
          {preview && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={removeAvatar} className="gap-1.5 text-red-400">
              <X className="w-3.5 h-3.5" /> Remover
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">JPG/PNG/WebP até 25 MB</p>
      </div>
    </div>
  );
}

function EditUser({ user }: { user: UserRow }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [role, setRole] = useState<Role>(user.role);
  const { user: me } = useAuth();
  const isSelf = me?.id === user.id;

  const update = trpc.users.update.useMutation({
    onSuccess: () => {
      toast.success("Usuário atualizado");
      utils.users.list.invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Editar">
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <AvatarUploader user={user} onChanged={() => {}} />
            <div>
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label>Papel</Label>
              <div className="flex gap-2 mt-1.5">
                <Button variant={role === "user" ? "default" : "outline"} size="sm" onClick={() => setRole("user")} disabled={isSelf}>
                  Usuário
                </Button>
                <Button variant={role === "admin" ? "default" : "outline"} size="sm" onClick={() => setRole("admin")}>
                  Admin
                </Button>
              </div>
              {isSelf && <p className="text-xs text-amber-400 mt-1">Você não pode demover a si mesmo.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={update.isPending}>Cancelar</Button>
            <Button
              onClick={() => update.mutate({ id: user.id, name, email, role })}
              disabled={update.isPending}
            >
              {update.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChangePassword({ user }: { user: UserRow }) {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const change = trpc.users.changePassword.useMutation({
    onSuccess: () => { toast.success("Senha alterada"); setOpen(false); setPwd(""); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Trocar senha">
        <KeyRound className="w-3.5 h-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Trocar senha de {user.name ?? user.email}</DialogTitle>
            <DialogDescription>Mínimo 8 caracteres.</DialogDescription>
          </DialogHeader>
          <Input type="password" placeholder="Nova senha" value={pwd} onChange={(e) => setPwd(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => change.mutate({ id: user.id, newPassword: pwd })}
              disabled={pwd.length < 8 || change.isPending}
            >
              {change.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToggleDisabled({ user }: { user: UserRow }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const { user: me } = useAuth();
  const isSelf = me?.id === user.id;
  const setDisabled = trpc.users.setDisabled.useMutation({
    onSuccess: () => {
      toast.success(user.disabled ? "Usuário reativado" : "Usuário desativado");
      utils.users.list.invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  if (isSelf) return null;
  const next = !user.disabled;
  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label={user.disabled ? "Reativar" : "Desativar"}>
        {user.disabled ? <Power className="w-3.5 h-3.5 text-emerald-400" /> : <Trash2 className="w-3.5 h-3.5 text-red-400" />}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{next ? "Desativar usuário?" : "Reativar usuário?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {user.name ?? user.email} {next ? "perderá acesso imediato (preserva histórico)." : "voltará a poder fazer login."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => setDisabled.mutate({ id: user.id, disabled: next })}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function InvitationsList() {
  const utils = trpc.useUtils();
  const { data } = trpc.invitations.list.useQuery(undefined, { refetchInterval: 30_000 });
  const revoke = trpc.invitations.revoke.useMutation({
    onSuccess: () => { toast.success("Convite revogado"); utils.invitations.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  if (!data || data.length === 0) return null;
  return (
    <Card className="border-white/5">
      <CardContent className="p-4">
        <h2 className="text-sm font-semibold mb-3">Convites pendentes</h2>
        <div className="space-y-2">
          {data.map((i) => {
            const isUsed = !!i.usedAt;
            const isExpired = i.expiresAt && new Date(i.expiresAt).getTime() < Date.now();
            const status = isUsed
              ? (i.usedByUserId === 0 ? "REVOGADO" : "USADO")
              : isExpired ? "EXPIRADO" : "PENDENTE";
            const tone = status === "PENDENTE" ? "bg-blue-500/15 text-blue-300"
                       : status === "USADO" ? "bg-emerald-500/15 text-emerald-300"
                       : "bg-zinc-500/15 text-zinc-300";
            return (
              <div key={i.id} className="flex items-center gap-3 border border-white/5 rounded-md p-2 text-xs">
                <Badge className={tone}>{status}</Badge>
                <Badge variant="outline">{i.role}</Badge>
                <span className="text-muted-foreground flex-1 truncate font-mono">{inviteUrl(i.token).slice(0, 60)}…</span>
                <span className="text-muted-foreground">{i.expiresAt ? `expira ${fmt(i.expiresAt)}` : "sem expiração"}</span>
                {!isUsed && !isExpired && (
                  <>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => { navigator.clipboard.writeText(inviteUrl(i.token)); toast.success("Link copiado"); }}
                      aria-label="Copiar"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="h-7 text-red-400"
                      onClick={() => revoke.mutate({ token: i.token })}
                      disabled={revoke.isPending}
                    >
                      Revogar
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function UsersTab() {
  const { data, isLoading } = trpc.users.list.useQuery(undefined, { refetchInterval: 30_000 });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.length} usuário(s)` : "Carregando…"}
        </p>
        <CreateInvite />
      </div>

      <Card className="border-white/5">
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
          {data?.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{u.name ?? u.email ?? u.openId}</span>
                  {u.disabled && <Badge variant="outline" className="text-zinc-500">DESATIVADO</Badge>}
                  <Badge className={u.role === "admin" ? "bg-blue-500/15 text-blue-300" : "bg-zinc-500/15 text-zinc-300"}>
                    {u.role === "admin" ? "ADMIN" : "USUÁRIO"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {u.email ?? u.openId} · último login {fmt(u.lastSignedIn)}
                </p>
              </div>
              <div className="flex items-center gap-0.5">
                <EditUser user={u as UserRow} />
                <ChangePassword user={u as UserRow} />
                <ToggleDisabled user={u as UserRow} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <InvitationsList />
    </div>
  );
}
