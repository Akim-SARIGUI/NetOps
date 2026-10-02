import { requireUser } from "@/server/auth/context";
import { json, readSearchParams, route } from "@/server/http";
import { monitoringDashboard } from "@/server/services/monitoring";
import { monitoringQuerySchema } from "@/server/validation/monitoring";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await monitoringDashboard(user, organizationId, readSearchParams(request, monitoringQuerySchema)));
});
