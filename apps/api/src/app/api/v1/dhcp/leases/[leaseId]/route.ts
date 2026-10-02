import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteDhcpLease } from "@/server/services/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ leaseId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { leaseId } = await (context as Context).params;
  return json(await deleteDhcpLease(user, leaseId));
});
