import { z } from "zod";

export const POLICY_PROTOCOLS = ["ANY", "TCP", "UDP", "ICMP"] as const;
export const POLICY_ACTIONS = ["ALLOW", "DENY"] as const;

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export const firewallQuerySchema = z.object({
  siteId: z.preprocess(blank, z.uuid().optional()),
});

export const createZoneSchema = z.object({
  name: z.string().trim().min(1).max(32).refine((value) => NAME.test(value), "Nom de zone invalide"),
  description: optionalText(500),
  vlanIds: z.array(z.uuid()).max(64).optional(),
});

export const createFlowSchema = z.object({
  priority: z.number().int(),
  source: z.string().trim().min(1).max(64),
  destination: z.string().trim().min(1).max(64),
  protocol: z.enum(POLICY_PROTOCOLS).optional(),
  sourcePort: z.preprocess(blank, z.string().trim().max(16).nullable().optional()),
  destinationPort: z.preprocess(blank, z.string().trim().max(16).nullable().optional()),
  action: z.enum(POLICY_ACTIONS),
  logging: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const createAclSchema = z.object({
  name: z.string().trim().min(1).max(64).refine((value) => NAME.test(value), "Nom d'ACL invalide"),
  deviceId: z.preprocess(blank, z.uuid().optional()),
  description: optionalText(500),
});

export const createAclRuleSchema = createFlowSchema;
