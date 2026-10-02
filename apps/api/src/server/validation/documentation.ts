import { z } from "zod";
import { FORMATS } from "../documentation/evaluate";

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

export const documentationQuerySchema = z.object({
  siteId: z.preprocess(blank, z.uuid().optional()),
});

export const documentationExportSchema = z.object({
  siteId: z.preprocess(blank, z.uuid().optional()),
  format: z.enum(FORMATS),
});
