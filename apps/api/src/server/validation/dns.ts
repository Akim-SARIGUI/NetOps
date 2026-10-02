import { z } from "zod";
import { DNS_TYPES } from "../dns/records";

export const DNS_SERVER_STATUSES = ["PLANNED", "ACTIVE", "DISABLED"] as const;
export const DNS_ZONE_KINDS = ["FORWARD", "REVERSE"] as const;

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const dnsQuerySchema = z.object({
  q: z.preprocess(blank, z.string().trim().max(253).optional()),
  siteId: z.preprocess(blank, z.uuid().optional()),
});

export const createDnsServerSchema = z.object({
  siteId: z.uuid(),
  name: z.string().trim().min(1).max(64),
  description: optionalText(500),
  address: z.preprocess(blank, z.string().trim().min(2).max(64).optional()),
  deviceId: z.preprocess(blank, z.uuid().optional()),
  status: z.enum(DNS_SERVER_STATUSES).optional(),
});

export const updateDnsServerSchema = createDnsServerSchema
  .omit({ siteId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const createDnsZoneSchema = z.object({
  serverId: z.uuid(),
  kind: z.enum(DNS_ZONE_KINDS),
  name: z.preprocess(blank, z.string().trim().min(1).max(253).optional()),
  subnetId: z.preprocess(blank, z.uuid().optional()),
  ttl: z.number().int().min(1).max(2_147_483_647).optional(),
  description: optionalText(500),
});

export const updateDnsZoneSchema = z
  .object({
    serverId: z.uuid().optional(),
    ttl: z.number().int().min(1).max(2_147_483_647).optional(),
    enabled: z.boolean().optional(),
    description: optionalText(500),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const createDnsRecordSchema = z.object({
  name: z.string().trim().min(1).max(253),
  type: z.enum(DNS_TYPES),
  value: z.string().trim().min(1).max(1024),
  ttl: z.number().int().min(1).max(2_147_483_647).optional(),
  priority: z.number().int().min(0).max(65535).optional(),
  weight: z.number().int().min(0).max(65535).optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

export const updateDnsRecordSchema = createDnsRecordSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const resolveDnsSchema = z.object({
  name: z.string().trim().min(1).max(253),
  type: z.enum(DNS_TYPES).optional(),
});
