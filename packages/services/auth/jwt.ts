import jwt from "jsonwebtoken";
import type { Response } from "express";

import { env } from "../env";
import { getClearJwtCookieOptions, getJwtCookieOptions } from "./jwt-cookie-options";

import type { UserRole } from "./roles";

const refreshSecret = () => env.JWT_REFRESH_SECRET ?? env.JWT_SECRET;
const JWT_ALGORITHMS = ["HS256"] as const;

export type AccessTokenPayload = {
  userId: string;
  emailVerified: boolean;
  role: UserRole;
};
export type RefreshTokenPayload = {
  userId: string;
  type: "refresh";
  emailVerified: boolean;
  role: UserRole;
  tokenVersion: string;
};

export type AuthTokenUser = {
  id: string;
  emailVerified: boolean;
  role: UserRole;
  tokenVersion: string;
};

export function issueAuthCookies(res: Response, user: AuthTokenUser) {
  const accessToken = jwt.sign(
    {
      userId: user.id,
      emailVerified: user.emailVerified,
      role: user.role,
    } satisfies AccessTokenPayload,
    env.JWT_SECRET,
    {
      expiresIn: "15m",
      algorithm: "HS256",
    },
  );

  const refreshToken = jwt.sign(
    {
      userId: user.id,
      type: "refresh",
      emailVerified: user.emailVerified,
      role: user.role,
      tokenVersion: user.tokenVersion,
    } satisfies RefreshTokenPayload,
    refreshSecret(),
    { expiresIn: "30d", algorithm: "HS256" },
  );

  const baseOpts = getJwtCookieOptions();

  res.cookie("jwt", accessToken, {
    ...baseOpts,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("jwt_refresh", refreshToken, {
    ...baseOpts,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookies(res: Response) {
  const clearOpts = getClearJwtCookieOptions();
  res.clearCookie("jwt", clearOpts);
  res.clearCookie("jwt_refresh", clearOpts);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: [...JWT_ALGORITHMS] }) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, refreshSecret(), {
    algorithms: [...JWT_ALGORITHMS],
  }) as RefreshTokenPayload;
  if (decoded.type !== "refresh") {
    throw new Error("Invalid token type");
  }
  return decoded;
}
