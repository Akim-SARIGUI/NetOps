import { requireUser } from "@/server/auth/context";
import { json, readJson, readSearchParams, route } from "@/server/http";
import { createInterface, listInterfaces } from "@/server/services/inventory";
import { createInterfaceSchema, interfaceListQuerySchema } from "@/server/validation/network";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ deviceId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { deviceId } = await (context as Context).params;
  const query = readSearchParams(request, interfaceListQuerySchema);
  return json(await listInterfaces(user, deviceId, query));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { deviceId } = await (context as Context).params;
  const input = await readJson(request, createInterfaceSchema);
  return json(await createInterface(user, deviceId, input), 201);
});
