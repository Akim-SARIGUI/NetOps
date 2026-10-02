import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteAddress } from "@/server/services/ipam";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ addressId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { addressId } = await (context as Context).params;
  return json(await deleteAddress(user, addressId));
});
