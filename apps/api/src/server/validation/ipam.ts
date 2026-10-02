import { z } from "zod";

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createNetworkSchema = z.object({
  siteId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  description: optionalText(500),
  cidr: z.string().trim().min(3).max(64),
});

export const updateNetworkSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: optionalText(500),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const createSubnetSchema = z.object({
  networkId: z.uuid(),
  vlanId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  description: optionalText(500),
  cidr: z.string().trim().min(3).max(64),
  gateway: z.string().trim().min(2).max(64),
});

export const updateSubnetSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: optionalText(500),
    gateway: z.string().trim().min(2).max(64).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const createAddressSchema = z
  .object({
    role: z.enum(["ALLOCATED", "RESERVED"]),
    address: z.preprocess(blank, z.string().trim().min(2).max(64).optional()),
    interfaceId: z.preprocess(blank, z.uuid().optional()),
    description: z.preprocess(blank, z.string().trim().min(1).max(500).optional()),
  })
  .superRefine((value, ctx) => {
    if (value.role === "ALLOCATED" && !value.interfaceId) {
      ctx.addIssue({ code: "custom", path: ["interfaceId"], message: "Une allocation exige une interface" });
    }
    if (value.role === "RESERVED" && value.interfaceId) {
      ctx.addIssue({ code: "custom", path: ["interfaceId"], message: "Une réservation n'est pas liée à une interface" });
    }
    if (value.role === "RESERVED" && !value.description) {
      ctx.addIssue({ code: "custom", path: ["description"], message: "Une réservation exige une description" });
    }
  });

export const vlsmSchema = z.object({
  cidr: z.string().trim().min(3).max(64),
  requests: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(80),
          hosts: z.number().int().positive().max(1_000_000_000).optional(),
          prefix: z.number().int().min(0).max(128).optional(),
        })
        .refine((value) => value.hosts !== undefined || value.prefix !== undefined, { message: "Indiquez un nombre d'hôtes ou un préfixe" }),
    )
    .min(1)
    .max(32),
});

export const ipamQuerySchema = z.object({
  siteId: z.preprocess(blank, z.uuid().optional()),
});
