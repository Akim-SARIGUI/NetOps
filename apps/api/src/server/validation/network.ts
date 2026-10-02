import { isIP } from "node:net";
import { z } from "zod";

export const DEVICE_ROLES = ["ROUTER", "SWITCH", "FIREWALL", "SERVER", "ACCESS_POINT", "CLIENT"] as const;
export const DEVICE_STATUSES = ["PLANNED", "ACTIVE", "MAINTENANCE", "OFFLINE", "DECOMMISSIONED"] as const;
export const INTERFACE_STATUSES = ["UP", "DOWN", "ADMIN_DOWN"] as const;
export const DUPLEX_MODES = ["AUTO", "FULL", "HALF"] as const;

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const INTERFACE_NAME = /^[A-Za-z][A-Za-z0-9_.:/-]{0,63}$/;

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase();
}

export function isHostname(value: string): boolean {
  return HOSTNAME.test(normalizeHostname(value));
}

export function isIpAddress(value: string): boolean {
  return isIP(value.trim()) !== 0;
}

export function normalizeMac(value: string): string | null {
  const hex = value.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(":");
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform(normalizeHostname)
  .refine((value) => HOSTNAME.test(value), "Nom d'hôte invalide");

const ipSchema = z
  .string()
  .trim()
  .max(45)
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .refine((value) => value === undefined || value === null || isIpAddress(value), "Adresse IP invalide");

const macSchema = z
  .string()
  .trim()
  .max(32)
  .nullable()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value.trim() === "") return null;
    const mac = normalizeMac(value);
    if (!mac) {
      ctx.addIssue({ code: "custom", message: "Adresse MAC invalide" });
      return z.NEVER;
    }
    return mac;
  });

const locationSchema = {
  siteId: z.uuid(),
  buildingId: z.uuid().nullable().optional(),
  roomId: z.uuid().nullable().optional(),
  rackId: z.uuid().nullable().optional(),
};

export const createDeviceSchema = z.object({
  role: z.enum(DEVICE_ROLES),
  hostname: hostnameSchema,
  managementIp: ipSchema,
  vendor: optionalText(80),
  model: optionalText(80),
  os: optionalText(80),
  osVersion: optionalText(80),
  serialNumber: optionalText(80),
  status: z.enum(DEVICE_STATUSES).optional(),
  description: optionalText(500),
  ...locationSchema,
});

export const updateDeviceSchema = createDeviceSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const createInterfaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((value) => INTERFACE_NAME.test(value), "Nom d'interface invalide"),
  ipAddress: ipSchema,
  macAddress: macSchema,
  speedMbps: z.number().int().min(1).max(800000).nullable().optional(),
  duplex: z.enum(DUPLEX_MODES).nullable().optional(),
  status: z.enum(INTERFACE_STATUSES).optional(),
  description: optionalText(500),
});

export const updateInterfaceSchema = createInterfaceSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

export const deviceListQuerySchema = z.object({
  q: z.preprocess(blank, z.string().trim().max(120).optional()),
  role: z.preprocess(blank, z.enum(DEVICE_ROLES).optional()),
  status: z.preprocess(blank, z.enum(DEVICE_STATUSES).optional()),
  siteId: z.preprocess(blank, z.uuid().optional()),
  buildingId: z.preprocess(blank, z.uuid().optional()),
  roomId: z.preprocess(blank, z.uuid().optional()),
  rackId: z.preprocess(blank, z.uuid().optional()),
  vendor: z.preprocess(blank, z.string().trim().max(80).optional()),
  limit: z.preprocess(blank, z.coerce.number().int().min(1).max(200).optional()),
});

export const interfaceListQuerySchema = z.object({
  q: z.preprocess(blank, z.string().trim().max(120).optional()),
});

export function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
