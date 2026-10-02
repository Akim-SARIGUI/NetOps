import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteRoom, getRoom, updateRoom } from "@/server/services/hierarchy";
import { updatePlaceSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ roomId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { roomId } = await (context as Context).params;
  return json(await getRoom(user, roomId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { roomId } = await (context as Context).params;
  const input = await readJson(request, updatePlaceSchema);
  return json(await updateRoom(user, roomId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { roomId } = await (context as Context).params;
  return json(await deleteRoom(user, roomId));
});
