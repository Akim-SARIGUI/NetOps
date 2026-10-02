import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createMonitoringTarget } from "@/server/services/monitoring";
import { createTargetSchema } from "@/server/validation/monitoring";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createMonitoringTarget(user, organizationId, await readJson(request, createTargetSchema)), 201);
});
