import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteMonitoringTarget, updateMonitoringTarget } from "@/server/services/monitoring";
import { updateTargetSchema } from "@/server/validation/monitoring";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ targetId: string }> };

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { targetId } = await (context as Context).params;
  return json(await updateMonitoringTarget(user, targetId, await readJson(request, updateTargetSchema)));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { targetId } = await (context as Context).params;
  return json(await deleteMonitoringTarget(user, targetId));
});
