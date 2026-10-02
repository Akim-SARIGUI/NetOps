import { z } from "zod";
import { isHostname } from "./network";

export const DHCP_SERVER_STATUSES = ["PLANNED", "ACTIVE", "DISABLED"] as const;

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const addressSchema = z.string().trim().min(2).max(64);
const rangeSchema = z.object({
  start: addressSchema,
  end: addressSchema,
});

export const dhcpQuerySchema = z.object({
  siteId: z.preprocess(blank, z.uuid().optional()),
});

export const createDhcpServerSchema = z.object({
  siteId: z.uuid(),
  name: z.string().trim().min(1).max(64),
  description: optionalText(500),
  address: z.preprocess(blank, addressSchema.optional()),
  deviceId: z.preprocess(blank, z.uuid().optional()),
  status: z.enum(DHCP_SERVER_STATUSES).optional(),
});

export const updateDhcpServerSchema = createDhcpServerSchema
  .omit({ siteId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const createDhcpScopeSchema = z.object({
  subnetId: z.uuid(),
  serverId: z.uuid(),
  gateway: z.preprocess(blank, addressSchema.optional()),
  dnsServers: z.array(addressSchema).max(8).optional(),
  domain: z.preprocess(blank, z.string().trim().max(253).refine((value) => isHostname(value), "Nom de domaine invalide").optional()),
  leaseSeconds: z.number().int().min(60, "La durée minimale d'un bail est de 60 secondes").max(31_536_000).optional(),
  enabled: z.boolean().optional(),
  description: optionalText(500),
  pool: rangeSchema.optional(),
});

export const updateDhcpScopeSchema = z
  .object({
    serverId: z.uuid().optional(),
    gateway: addressSchema.optional(),
    dnsServers: z.array(addressSchema).max(8).optional(),
    domain: z.string().trim().max(253).nullable().optional(),
    leaseSeconds: z.number().int().min(60).max(31_536_000).optional(),
    enabled: z.boolean().optional(),
    description: optionalText(500),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const createDhcpPoolSchema = rangeSchema;
export const createDhcpExclusionSchema = rangeSchema.extend({ reason: optionalText(200) });

export const createDhcpReservationSchema = z.object({
  address: addressSchema,
  macAddress: z.string().trim().min(2).max(32),
  hostname: z.preprocess(blank, z.string().trim().max(253).refine((value) => isHostname(value), "Nom d'hôte invalide").optional()),
  description: optionalText(500),
});

export const createDhcpLeaseSchema = z.object({
  address: addressSchema,
  macAddress: z.string().trim().min(2).max(32),
  hostname: z.preprocess(blank, z.string().trim().max(253).refine((value) => isHostname(value), "Nom d'hôte invalide").optional()),
});

export const simulateDhcpLeaseSchema = z.object({
  macAddress: z.string().trim().min(2).max(32),
  hostname: z.preprocess(blank, z.string().trim().max(253).refine((value) => isHostname(value), "Nom d'hôte invalide").optional()),
});

export const createDhcpRelaySchema = z.object({
  subnetId: z.uuid(),
  serverId: z.uuid(),
  interfaceId: z.preprocess(blank, z.uuid().optional()),
  helperAddress: addressSchema,
  description: optionalText(500),
});
