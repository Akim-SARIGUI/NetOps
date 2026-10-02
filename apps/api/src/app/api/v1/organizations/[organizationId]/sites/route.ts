import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createSite, listSites } from "@/server/services/hierarchy";
import { createSiteSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await listSites(user, organizationId));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, createSiteSchema);
  return json(await createSite(user, organizationId, input), 201);
});
