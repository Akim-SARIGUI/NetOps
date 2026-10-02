import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createDhcpReservation } from "@/server/services/dhcp";
import { createDhcpReservationSchema } from "@/server/validation/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ scopeId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { scopeId } = await (context as Context).params;
  const input = await readJson(request, createDhcpReservationSchema);
  return json(await createDhcpReservation(user, scopeId, input), 201);
});
