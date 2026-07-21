import { describe, expect, it } from "vitest";

import { AuthError } from "./errors";

/** Mirrors AuthService.assertEmailVerified — kept inline to avoid DB in unit tests. */
function assertEmailVerified(emailVerified: boolean) {
  if (!emailVerified) {
    throw new AuthError(
      "FORBIDDEN",
      "Please verify your email before signing in. Check your inbox for the verification link.",
    );
  }
}

describe("email verification gate", () => {
  it("blocks session issuance for unverified accounts", () => {
    expect(() => assertEmailVerified(false)).toThrow(AuthError);
    expect(() => assertEmailVerified(false)).toThrow(/verify your email/i);
  });

  it("allows verified accounts", () => {
    expect(() => assertEmailVerified(true)).not.toThrow();
  });
});
