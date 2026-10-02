import { z } from "zod";

export const LINK_STATUSES = ["UP", "DOWN", "ADMIN_DOWN", "UNKNOWN"] as const;

function blank(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const coordinate = z.number().finite().min(-20000).max(20000);

export const topologyQuerySchema = z.object({
  siteId: z.preprocess(blank, z.uuid().optional()),
  q: z.preprocess(blank, z.string().trim().max(80).optional()),
});

export const createMarkerSchema = z.object({
  siteId: z.uuid(),
  x: coordinate.optional(),
  y: coordinate.optional(),
});

export const moveMarkerSchema = z.object({
  x: coordinate,
  y: coordinate,
});

export const savePlacementSchema = z.object({
  deviceId: z.uuid(),
  x: coordinate,
  y: coordinate,
});

export const createLinkSchema = z.object({
  sourceDeviceId: z.preprocess(blank, z.uuid().optional()),
  sourceMarkerId: z.preprocess(blank, z.uuid().optional()),
  targetDeviceId: z.preprocess(blank, z.uuid().optional()),
  targetMarkerId: z.preprocess(blank, z.uuid().optional()),
  sourcePort: z.preprocess(blank, z.string().trim().max(64).optional()),
  targetPort: z.preprocess(blank, z.string().trim().max(64).optional()),
  speedMbps: z.number().int().min(1).max(800000).nullable().optional(),
  status: z.enum(LINK_STATUSES).optional(),
  vlanId: z.preprocess(blank, z.uuid().optional()),
  trafficBps: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
});
