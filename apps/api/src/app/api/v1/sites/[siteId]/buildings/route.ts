import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createBuilding, listBuildings } from "@/server/services/hierarchy";
import { createPlaceSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ siteId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { siteId } = await (context as Context).params;
  return json(await listBuildings(user, siteId));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { siteId } = await (context as Context).params;
  const input = await readJson(request, createPlaceSchema);
  return json(await createBuilding(user, siteId, input), 201);
});
