import { requireUser } from "@/server/auth/context";
import { discoveryOverview } from "@/server/services/discovery";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await discoveryOverview(user, organizationId));
});
