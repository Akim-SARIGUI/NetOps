import { requireUser } from "@/server/auth/context";
import { preparePromotion } from "@/server/services/lab";
import { json, readJson, route } from "@/server/http";
import { preparePromotionSchema } from "@/server/validation/lab";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ fabricId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { fabricId } = await (context as Context).params;
  return json(await preparePromotion(user, fabricId, await readJson(request, preparePromotionSchema)), 201);
});
