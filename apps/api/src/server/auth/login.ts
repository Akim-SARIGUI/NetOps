import { logger } from "../logger";
import { prisma } from "../prisma";
import { UnauthorizedError } from "../errors";
import { toSession, type SessionPayload } from "./context";
import { verifyPassword } from "./passwords";
import { signAccessToken } from "./tokens";

export async function login(email: string, password: string): Promise<SessionPayload & { token: string }> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      memberships: {
        include: { organization: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !user.isActive || !valid) {
    logger.warn({ email: email.toLowerCase() }, "failed login");
    throw new UnauthorizedError("Identifiants invalides");
  }

  const authUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    memberships: user.memberships.map((membership) => ({
      organizationId: membership.organizationId,
      role: membership.role,
      organization: membership.organization,
    })),
  };

  const token = await signAccessToken(user.id);
  logger.info({ userId: user.id }, "login");
  return { token, ...toSession(authUser) };
}
