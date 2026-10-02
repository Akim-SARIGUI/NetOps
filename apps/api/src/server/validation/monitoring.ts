import { z } from "zod";

export const COLLECTOR_MODES = ["SIMULATION", "ICMP", "SNMP"] as const;

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

export const monitoringQuerySchema = z.object({
  siteId: z.preprocess(blank, z.uuid().optional()),
});

export const createTargetSchema = z.object({
  deviceId: z.uuid(),
  mode: z.enum(COLLECTOR_MODES).optional(),
  packetLossThreshold: z.number().min(0).max(100).optional(),
});

export const updateTargetSchema = z
  .object({
    mode: z.enum(COLLECTOR_MODES).optional(),
    packetLossThreshold: z.number().min(0).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), { message: "Aucune modification" });
