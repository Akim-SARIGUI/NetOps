import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createInternetMarker } from "@/server/services/topology";
import { createMarkerSchema } from "@/server/validation/topology";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createInternetMarker(user, organizationId, await readJson(request, createMarkerSchema)), 201);
});
