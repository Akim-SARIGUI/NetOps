import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteDhcpReservation } from "@/server/services/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ reservationId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { reservationId } = await (context as Context).params;
  return json(await deleteDhcpReservation(user, reservationId));
});
