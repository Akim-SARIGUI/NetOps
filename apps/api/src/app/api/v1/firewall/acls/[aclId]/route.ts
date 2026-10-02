import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteAcl } from "@/server/services/firewall";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ aclId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { aclId } = await (context as Context).params;
  return json(await deleteAcl(user, aclId));
});
