import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { savePlacement } from "@/server/services/topology";
import { savePlacementSchema } from "@/server/validation/topology";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await savePlacement(user, organizationId, await readJson(request, savePlacementSchema)));
});
