import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Cog, MessageSquare, Battery } from "lucide-react";
import { UsersTab } from "@/components/settings/UsersTab";
import { SystemTab } from "@/components/settings/SystemTab";
import { WhatsappTab } from "@/components/settings/WhatsappTab";
import { SitesTab } from "@/components/settings/SitesTab";

export default function Settings() {
  const { isAdmin, loading } = useAuth();
  const [tab, setTab] = useState<"users" | "sites" | "system" | "whatsapp">("users");

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-6 px-3">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-3">
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-6">
            <h1 className="text-lg font-semibold text-red-300 mb-2">Acesso negado</h1>
            <p className="text-sm text-muted-foreground">
              Apenas administradores podem acessar a área de configurações.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-4 px-3 md:px-0 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Gestão de usuários, integrações e manutenção do sistema
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="w-full">
        <TabsList className="grid w-full grid-cols-4 max-w-xl">
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="w-3.5 h-3.5" /> Usuários
          </TabsTrigger>
          <TabsTrigger value="sites" className="gap-1.5">
            <Battery className="w-3.5 h-3.5" /> Sites
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-1.5">
            <Cog className="w-3.5 h-3.5" /> Sistema
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-5">
          <UsersTab />
        </TabsContent>
        <TabsContent value="sites" className="mt-5">
          <SitesTab />
        </TabsContent>
        <TabsContent value="system" className="mt-5">
          <SystemTab />
        </TabsContent>
        <TabsContent value="whatsapp" className="mt-5">
          <WhatsappTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
