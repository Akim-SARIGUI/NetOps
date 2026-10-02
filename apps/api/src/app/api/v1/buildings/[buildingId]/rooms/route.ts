import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createRoom, listRooms } from "@/server/services/hierarchy";
import { createPlaceSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ buildingId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { buildingId } = await (context as Context).params;
  return json(await listRooms(user, buildingId));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { buildingId } = await (context as Context).params;
  const input = await readJson(request, createPlaceSchema);
  return json(await createRoom(user, buildingId, input), 201);
});
