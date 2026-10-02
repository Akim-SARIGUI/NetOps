import { z } from "zod";

export const LAYER3_KINDS = ["PHYSICAL", "SVI", "SUBINTERFACE"] as const;
export const LAYER3_STATUSES = ["PLANNED", "ACTIVE", "DISABLED"] as const;
export const ROUTE_PROTOCOLS = ["STATIC", "DEFAULT", "OSPF"] as const;

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const NAME = /^[A-Za-z][A-Za-z0-9_.:/-]{0,63}$/;

export const routingQuerySchema = z.object({
  siteId: z.preprocess(blank, z.uuid().optional()),
});

export const createLayer3Schema = z.object({
  deviceId: z.uuid(),
  name: z.string().trim().min(1).max(64).refine((value) => NAME.test(value), "Nom d'interface invalide"),
  kind: z.enum(LAYER3_KINDS),
  vlanId: z.preprocess(blank, z.uuid().optional()),
  parentInterfaceId: z.preprocess(blank, z.uuid().optional()),
  address: z.string().trim().min(2).max(64),
  subnetId: z.uuid(),
  status: z.enum(LAYER3_STATUSES).optional(),
  description: optionalText(500),
});

export const createRouteSchema = z.object({
  deviceId: z.uuid(),
  protocol: z.enum(ROUTE_PROTOCOLS),
  cidr: z.string().trim().min(3).max(64),
  gateway: z.string().trim().min(2).max(64),
  layer3InterfaceId: z.preprocess(blank, z.uuid().optional()),
  metric: z.number().int().min(1).max(255).optional(),
  description: optionalText(500),
});

export const createOspfSchema = z.object({
  deviceId: z.uuid(),
  processId: z.number().int().min(1).max(65535),
  routerId: z.string().trim().min(7).max(64),
  areaId: z.preprocess(blank, z.string().trim().min(1).max(32).optional()),
  interfaceIds: z.array(z.uuid()).max(64).optional(),
  description: optionalText(500),
});
