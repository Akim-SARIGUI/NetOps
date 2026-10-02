import { requireUser } from "@/server/auth/context";
import { deleteLabFabric } from "@/server/services/lab";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ fabricId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { fabricId } = await (context as Context).params;
  return json(await deleteLabFabric(user, fabricId));
});
