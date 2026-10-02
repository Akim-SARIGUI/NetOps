import { SignJWT, jwtVerify } from "jose";
import { getConfig } from "../config";
import { UnauthorizedError } from "../errors";

function secretKey() {
  return new TextEncoder().encode(getConfig().JWT_SECRET);
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(getConfig().JWT_EXPIRES_IN)
    .sign(secretKey());
}

export async function readAccessToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub) throw new Error("missing subject");
    return payload.sub;
  } catch {
    throw new UnauthorizedError("Session invalide ou expirée");
  }
}
