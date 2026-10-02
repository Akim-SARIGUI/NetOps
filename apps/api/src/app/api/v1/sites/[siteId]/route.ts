import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteSite, getSite, updateSite } from "@/server/services/hierarchy";
import { updateSiteSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ siteId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { siteId } = await (context as Context).params;
  return json(await getSite(user, siteId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { siteId } = await (context as Context).params;
  const input = await readJson(request, updateSiteSchema);
  return json(await updateSite(user, siteId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { siteId } = await (context as Context).params;
  return json(await deleteSite(user, siteId));
});
