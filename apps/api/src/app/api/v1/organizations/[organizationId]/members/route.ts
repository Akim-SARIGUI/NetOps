import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { addMember, listMembers } from "@/server/services/members";
import { addMemberSchema } from "@/server/validation/common";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await listMembers(user, organizationId));
});

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, addMemberSchema);
  return json(await addMember(user, organizationId, input), 201);
});
