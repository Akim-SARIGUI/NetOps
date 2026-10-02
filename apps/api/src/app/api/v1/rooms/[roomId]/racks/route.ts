import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createRack, listRacks } from "@/server/services/hierarchy";
import { createRackSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ roomId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { roomId } = await (context as Context).params;
  return json(await listRacks(user, roomId));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { roomId } = await (context as Context).params;
  const input = await readJson(request, createRackSchema);
  return json(await createRack(user, roomId, input), 201);
});
