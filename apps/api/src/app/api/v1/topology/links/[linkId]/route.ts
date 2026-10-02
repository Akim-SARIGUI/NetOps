import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteTopologyLink } from "@/server/services/topology";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ linkId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { linkId } = await (context as Context).params;
  return json(await deleteTopologyLink(user, linkId));
});
