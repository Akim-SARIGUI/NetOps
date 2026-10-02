import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { removeMember, updateMember } from "@/server/services/members";
import { updateMemberSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string; userId: string }> };

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId, userId } = await (context as Context).params;
  const input = await readJson(request, updateMemberSchema);
  return json(await updateMember(user, organizationId, userId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId, userId } = await (context as Context).params;
  return json(await removeMember(user, organizationId, userId));
});
