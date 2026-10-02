import { z } from "zod";
import { INTEGRATIONS, KINDS } from "../automation/evaluate";

const variableKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Nom de variable invalide");

export const updateAutomationPolicySchema = z.object({
  automaticCritical: z.boolean(),
});

export const createAutomationTemplateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(KINDS),
  body: z.string().trim().min(1).max(4000),
});

export const createAutomationJobSchema = z.object({
  deviceId: z.uuid(),
  templateId: z.uuid(),
  integration: z.enum(INTEGRATIONS),
  label: z.string().trim().min(2).max(80).optional(),
  variables: z.record(variableKey, z.string().trim().min(1).max(120)).optional(),
});

export const approveAutomationSchema = z.object({
  authorize: z.boolean().optional(),
});
