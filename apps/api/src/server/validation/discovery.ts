import { z } from "zod";
import { CONNECTORS, DECISIONS } from "../discovery/evaluate";

export const createDiscoveryRunSchema = z.object({
  label: z.string().trim().min(2).max(80).optional(),
  siteId: z.uuid().optional(),
  connectors: z.array(z.enum(CONNECTORS)).min(1, "Choisissez au moins un connecteur"),
});

export const approveDiscoverySchema = z.object({
  decisions: z.array(z.object({ findingId: z.uuid(), decision: z.enum(DECISIONS) })),
});

export const importDiscoverySchema = z.object({
  siteId: z.uuid(),
  confirmProduction: z.boolean().optional(),
});
