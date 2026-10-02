import { requireUser } from "@/server/auth/context";
import { deletePromotion } from "@/server/services/lab";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ promotionId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { promotionId } = await (context as Context).params;
  return json(await deletePromotion(user, promotionId));
});
