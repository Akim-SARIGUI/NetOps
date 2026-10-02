import { z } from "zod";
import { normalizeMac } from "./network";

export const VLAN_ROLES = ["DATA", "VOICE", "MANAGEMENT", "GUEST", "SERVER", "TRANSIT", "NATIVE"] as const;
export const SECURITY_ZONES = ["TRUST", "UNTRUST", "DMZ", "GUEST", "MANAGEMENT", "INTERNAL"] as const;
export const VLAN_STATUSES = ["ACTIVE", "PLANNED", "RESERVED", "DEPRECATED"] as const;
export const PORT_MODES = ["ACCESS", "TRUNK"] as const;
export const PORT_STATUSES = ["UP", "DOWN", "ADMIN_DOWN", "ERR_DISABLED"] as const;
export const POE_STATUSES = ["OFF", "ON", "FAULT"] as const;

const PORT_NAME = /^[A-Za-z][A-Za-z0-9_.:/-]{0,63}$/;

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

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

const vlanObject = z.object({
  siteId: z.uuid(),
  vid: z.number().int().min(1, "Le VLAN ID doit être compris entre 1 et 4094").max(4094, "Le VLAN ID doit être compris entre 1 et 4094"),
  name: z.string().trim().min(1).max(64),
  description: optionalText(500),
  role: z.enum(VLAN_ROLES),
  securityZone: z.enum(SECURITY_ZONES),
  status: z.enum(VLAN_STATUSES).optional(),
  cidr: z.preprocess(blank, z.string().trim().min(3).max(64).optional()),
  gateway: z.preprocess(blank, z.string().trim().min(2).max(64).optional()),
});

export const createVlanSchema = vlanObject.superRefine((value, ctx) => {
  if (Boolean(value.cidr) !== Boolean(value.gateway)) {
    ctx.addIssue({ code: "custom", path: ["cidr"], message: "Le sous-réseau et la passerelle doivent être saisis ensemble" });
  }
});

export const updateVlanSchema = vlanObject
  .omit({ siteId: true, cidr: true, gateway: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const attachVlanSubnetSchema = z.object({
  cidr: z.string().trim().min(3).max(64),
  gateway: z.string().trim().min(2).max(64),
});

export const vlanListQuerySchema = z.object({
  q: z.preprocess(blank, z.string().trim().max(120).optional()),
  siteId: z.preprocess(blank, z.uuid().optional()),
  role: z.preprocess(blank, z.enum(VLAN_ROLES).optional()),
  status: z.preprocess(blank, z.enum(VLAN_STATUSES).optional()),
  securityZone: z.preprocess(blank, z.enum(SECURITY_ZONES).optional()),
  limit: z.preprocess(blank, z.coerce.number().int().min(1).max(500).optional()),
});

const portFields = {
  name: z.string().trim().min(1).max(64).refine((value) => PORT_NAME.test(value), "Numéro de port invalide"),
  status: z.enum(PORT_STATUSES).optional(),
  mode: z.enum(PORT_MODES),
  accessVlanId: z.uuid().nullable().optional(),
  nativeVlanId: z.uuid().nullable().optional(),
  allowedVlanIds: z.array(z.uuid()).max(256).optional(),
  speedMbps: z.number().int().min(1).max(800000).nullable().optional(),
  duplex: z.enum(["AUTO", "FULL", "HALF"]).nullable().optional(),
  description: optionalText(500),
  connectedDeviceId: z.uuid().nullable().optional(),
  macAddress: macSchema,
  poe: z.enum(POE_STATUSES).optional(),
};

export const createPortSchema = z.object(portFields);

export const updatePortSchema = z
  .object(portFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });
