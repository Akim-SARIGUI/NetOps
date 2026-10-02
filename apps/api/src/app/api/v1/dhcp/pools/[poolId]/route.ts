import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteDhcpPool } from "@/server/services/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ poolId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { poolId } = await (context as Context).params;
  return json(await deleteDhcpPool(user, poolId));
});
