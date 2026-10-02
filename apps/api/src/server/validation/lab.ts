import { z } from "zod";

export const createLabSchema = z.object({
  siteId: z.uuid(),
});

export const preparePromotionSchema = z.object({
  targetSiteId: z.uuid(),
  sourcePromotionId: z.uuid().optional(),
});

export const promoteSchema = z.object({
  confirmProduction: z.boolean().optional(),
});
