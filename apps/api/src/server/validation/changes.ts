import { z } from "zod";
import { INTEGRATIONS } from "../automation/evaluate";

export const createChangeSchema = z.object({
  deviceId: z.uuid(),
  title: z.string().trim().min(2).max(120),
  integration: z.enum(INTEGRATIONS),
  proposedContent: z.string().trim().min(1).max(8000),
});
