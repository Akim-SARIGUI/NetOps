import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteOspfProcess } from "@/server/services/routing";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ processId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { processId } = await (context as Context).params;
  return json(await deleteOspfProcess(user, processId));
});
