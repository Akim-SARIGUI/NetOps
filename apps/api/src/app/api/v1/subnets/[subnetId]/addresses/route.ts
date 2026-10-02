import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createAddress } from "@/server/services/ipam";
import { createAddressSchema } from "@/server/validation/ipam";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ subnetId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { subnetId } = await (context as Context).params;
  const input = await readJson(request, createAddressSchema);
  return json(await createAddress(user, subnetId, input), 201);
});
