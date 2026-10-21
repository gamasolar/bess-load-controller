/**
 * tRPC da biblioteca de manuais + catálogo de falhas (somente leitura, exige
 * login). O PDF em si é servido por `manuals-routes.ts` em /api/manuals/:id/file.
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getActiveAlarms } from "./db";
import {
  faultCatalogStats, interpretAlarmType, listFaults, listManuals, lookupByCode,
} from "./manuals-faults";

export const manualsRouter = router({
  // Biblioteca: lista os documentos cadastrados (sem o binário).
  list: protectedProcedure.query(() => listManuals()),

  // Catálogo de falhas, com filtros opcionais.
  faults: protectedProcedure
    .input(z.object({
      manufacturer: z.string().max(48).optional(),
      equipmentKind: z.string().max(24).optional(),
      code: z.number().int().optional(),
      q: z.string().max(120).optional(),
      limit: z.number().int().min(1).max(2000).optional(),
    }).optional())
    .query(({ input }) => listFaults(input ?? {})),

  // Procura uma falha específica pelo código (Alarm ID).
  faultByCode: protectedProcedure
    .input(z.object({ code: z.number().int(), manufacturer: z.string().max(48).optional(), subId: z.number().int().nullish() }))
    .query(({ input }) => lookupByCode(input.code, { manufacturer: input.manufacturer, subId: input.subId ?? null })),

  // Resumo por tipo de equipamento (para o cabeçalho da aba).
  faultStats: protectedProcedure.query(() => faultCatalogStats()),

  // Interpreta um tipo de alarme do nosso banco (ex.: "HUAWEI_2032") → causa + solução do manual.
  interpret: protectedProcedure
    .input(z.object({ type: z.string().max(64) }))
    .query(({ input }) => interpretAlarmType(input.type)),

  // Alarmes ativos de um site, já com a interpretação do manual anexada.
  siteAlarms: protectedProcedure
    .input(z.object({ siteId: z.number().int() }))
    .query(async ({ input }) => {
      const alarms = await getActiveAlarms(input.siteId);
      const out = [];
      for (const a of alarms) {
        const interp = await interpretAlarmType(a.type);
        out.push({ ...a, fault: interp.fault, otherCauses: interp.others });
      }
      return out;
    }),
});
