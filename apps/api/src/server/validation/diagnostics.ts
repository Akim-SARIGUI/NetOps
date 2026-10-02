import { z } from "zod";
import { MODES, TOOLS } from "../diagnostics/evaluate";

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

export const diagnosticQuerySchema = z.object({
  deviceId: z.preprocess(blank, z.uuid().optional()),
});

export const guideSchema = z.object({
  deviceId: z.uuid(),
});

export const probeSchema = z
  .object({
    deviceId: z.uuid(),
    tool: z.enum(TOOLS),
    mode: z.enum(MODES),
    port: z.number().int().min(1).max(65535).optional(),
    name: z.string().trim().min(1).max(253).optional(),
  })
  .superRefine((value, context) => {
    if (value.tool === "PORT" && value.port === undefined) {
      context.addIssue({ code: "custom", path: ["port"], message: "Le test de port exige un port autorisé." });
    }
  });
