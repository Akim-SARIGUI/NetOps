import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteMarker, moveMarker } from "@/server/services/topology";
import { moveMarkerSchema } from "@/server/validation/topology";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ markerId: string }> };

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { markerId } = await (context as Context).params;
  return json(await moveMarker(user, markerId, await readJson(request, moveMarkerSchema)));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { markerId } = await (context as Context).params;
  return json(await deleteMarker(user, markerId));
});
