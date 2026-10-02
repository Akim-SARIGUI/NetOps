import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteDhcpExclusion } from "@/server/services/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ exclusionId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { exclusionId } = await (context as Context).params;
  return json(await deleteDhcpExclusion(user, exclusionId));
});
