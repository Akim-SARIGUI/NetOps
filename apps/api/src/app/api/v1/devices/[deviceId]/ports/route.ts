import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createPort, listPorts } from "@/server/services/switching";
import { createPortSchema } from "@/server/validation/switching";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ deviceId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { deviceId } = await (context as Context).params;
  return json(await listPorts(user, deviceId));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { deviceId } = await (context as Context).params;
  const input = await readJson(request, createPortSchema);
  return json(await createPort(user, deviceId, input), 201);
});
