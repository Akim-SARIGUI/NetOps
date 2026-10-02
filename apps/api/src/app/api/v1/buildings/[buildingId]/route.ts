import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteBuilding, getBuilding, updateBuilding } from "@/server/services/hierarchy";
import { updatePlaceSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ buildingId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { buildingId } = await (context as Context).params;
  return json(await getBuilding(user, buildingId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { buildingId } = await (context as Context).params;
  const input = await readJson(request, updatePlaceSchema);
  return json(await updateBuilding(user, buildingId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { buildingId } = await (context as Context).params;
  return json(await deleteBuilding(user, buildingId));
});
