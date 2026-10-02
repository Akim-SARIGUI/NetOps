import { requireUser } from "@/server/auth/context";
import { promoteLab } from "@/server/services/lab";
import { json, readJson, route } from "@/server/http";
import { promoteSchema } from "@/server/validation/lab";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ promotionId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { promotionId } = await (context as Context).params;
  return json(await promoteLab(user, promotionId, await readJson(request, promoteSchema)));
});
