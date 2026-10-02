import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteDnsRecord, updateDnsRecord } from "@/server/services/dns";
import { updateDnsRecordSchema } from "@/server/validation/dns";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ recordId: string }> };

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { recordId } = await (context as Context).params;
  const input = await readJson(request, updateDnsRecordSchema);
  return json(await updateDnsRecord(user, recordId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { recordId } = await (context as Context).params;
  return json(await deleteDnsRecord(user, recordId));
});
