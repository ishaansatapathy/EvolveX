export type AuthErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function hasConnectionRefused(error: unknown, depth = 0): boolean {
  if (!error || depth > 4) return false;
  if (typeof error === "object" && "code" in error && error.code === "ECONNREFUSED") {
    return true;
  }
  if (error instanceof Error && error.cause) {
    return hasConnectionRefused(error.cause, depth + 1);
  }
  return false;
}

export function toAuthError(error: unknown, fallbackMessage: string): AuthError {
  if (error instanceof AuthError) return error;

  if (hasConnectionRefused(error)) {
    return new AuthError(
      "INTERNAL",
      "Database is not running. Start PostgreSQL (pnpm db:up) then run pnpm db:migrate.",
    );
  }

  if (error instanceof Error) {
    return new AuthError("INTERNAL", error.message || fallbackMessage);
  }

  return new AuthError("INTERNAL", fallbackMessage);
}
