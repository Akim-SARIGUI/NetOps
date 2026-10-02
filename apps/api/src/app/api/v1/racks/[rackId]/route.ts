import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteRack, getRack, updateRack } from "@/server/services/hierarchy";
import { updateRackSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ rackId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { rackId } = await (context as Context).params;
  return json(await getRack(user, rackId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { rackId } = await (context as Context).params;
  const input = await readJson(request, updateRackSchema);
  return json(await updateRack(user, rackId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { rackId } = await (context as Context).params;
  return json(await deleteRack(user, rackId));
});
