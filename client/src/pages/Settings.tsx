import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Cog, MessageSquare, Battery, Palette, Zap } from "lucide-react";
import { UsersTab } from "@/components/settings/UsersTab";
import { SystemTab } from "@/components/settings/SystemTab";
import { WhatsappTab } from "@/components/settings/WhatsappTab";
import { SitesTab } from "@/components/settings/SitesTab";
import { PersonalizacaoTab } from "@/components/settings/PersonalizacaoTab";
import { AutomacaoTab } from "@/components/settings/AutomacaoTab";

export default function Settings() {
  const { isAdmin, loading } = useAuth();
  type TabId = "users" | "sites" | "automacao" | "personalizacao" | "system" | "whatsapp";
  // ?aba=automacao abre direto na aba (usado pelo link da tela de supervisão).
  const fromUrl = new URLSearchParams(window.location.search).get("aba") as TabId | null;
  const [tab, setTab] = useState<TabId>(fromUrl === "automacao" ? "automacao" : "users");

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
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 max-w-3xl h-auto">
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="w-3.5 h-3.5" /> Usuários
          </TabsTrigger>
          <TabsTrigger value="sites" className="gap-1.5">
            <Battery className="w-3.5 h-3.5" /> Sites
          </TabsTrigger>
          <TabsTrigger value="automacao" className="gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Automação
          </TabsTrigger>
          <TabsTrigger value="personalizacao" className="gap-1.5">
            <Palette className="w-3.5 h-3.5" /> Personalização
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
        <TabsContent value="automacao" className="mt-5">
          <AutomacaoTab />
        </TabsContent>
        <TabsContent value="personalizacao" className="mt-5">
          <PersonalizacaoTab />
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
