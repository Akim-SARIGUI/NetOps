import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createDhcpServer } from "@/server/services/dhcp";
import { createDhcpServerSchema } from "@/server/validation/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, createDhcpServerSchema);
  return json(await createDhcpServer(user, organizationId, input), 201);
});
