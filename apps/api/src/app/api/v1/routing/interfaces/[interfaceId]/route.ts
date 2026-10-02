import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteLayer3Interface } from "@/server/services/routing";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ interfaceId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { interfaceId } = await (context as Context).params;
  return json(await deleteLayer3Interface(user, interfaceId));
});
