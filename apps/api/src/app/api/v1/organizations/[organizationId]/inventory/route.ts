import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { inventorySummary } from "@/server/services/inventory";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await inventorySummary(user, organizationId));
});
