import { z } from "zod";
const assignableRoles = ["NETWORK_ADMIN", "NETWORK_OPERATOR", "AUDITOR", "VIEWER"] as const;

export const loginSchema = z.object({
  email: z.email("Adresse e-mail invalide"),
  password: z.string().min(1, "Mot de passe obligatoire"),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Le slug ne contient que des minuscules, des chiffres et des tirets")
    .optional(),
});

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
  })
  .refine((value) => value.name !== undefined || value.slug !== undefined, {
    message: "Aucune modification",
  });

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, "Le code ne contient que des lettres, des chiffres, _ et -");

export const environmentSchema = z.enum(["PRODUCTION", "STAGING", "LAB", "DEV"]);

export const createSiteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: codeSchema,
  environment: environmentSchema.optional(),
  address: z.string().trim().max(240).nullable().optional(),
});

export const updateSiteSchema = createSiteSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const createPlaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: codeSchema,
});

export const updatePlaceSchema = createPlaceSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const createRackSchema = createPlaceSchema.extend({
  heightU: z.number().int().min(1).max(58).optional(),
});

export const updateRackSchema = createRackSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification" });

export const addMemberSchema = z.object({
  email: z.email("Adresse e-mail invalide"),
  role: z.enum(assignableRoles),
});

export const updateMemberSchema = z.object({
  role: z.enum(assignableRoles),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const auditQuerySchema = listQuerySchema.extend({
  action: z.string().trim().min(1).max(80).optional(),
});

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
