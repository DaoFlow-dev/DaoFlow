import {
  markMfaEnrollmentDisabled,
  markMfaEnrollmentSatisfied,
  recordMfaAuthEvent
} from "./db/services/account-security";

type MfaAuditSession = {
  user: {
    id: string;
    email: string;
    role?: string | null;
    twoFactorEnabled?: boolean | null;
  };
} | null;

export async function auditMfaAuthResponse(input: {
  path: string;
  ok: boolean;
  response: Response;
  session: MfaAuditSession;
}) {
  const body = (await input.response
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;
  const bodyUser =
    body && typeof body.user === "object" ? (body.user as Record<string, unknown>) : null;
  const sessionUser = input.session?.user;
  const userId = sessionUser?.id ?? readBodyString(bodyUser, "id");
  const email = sessionUser?.email ?? readBodyString(bodyUser, "email");
  const role = typeof sessionUser?.role === "string" ? sessionUser.role : null;
  const outcome = input.ok ? "success" : "failure";
  const action = getMfaAuditAction(input.path, outcome);

  if (!action) return;

  if (input.ok && userId && input.path.endsWith("/two-factor/verify-totp")) {
    const wasEnrollmentVerification = input.session?.user.twoFactorEnabled === false;
    if (wasEnrollmentVerification) await markMfaEnrollmentSatisfied(userId);
  }

  if (input.ok && userId && input.path.endsWith("/two-factor/disable")) {
    await markMfaEnrollmentDisabled(userId);
  }

  await recordMfaAuthEvent({
    action,
    outcome,
    userId,
    email,
    role,
    detail: getMfaAuditDetail(input.path, outcome),
    metadata: {
      path: input.path,
      status: input.response.status,
      errorCode: readBodyString(body, "code") ?? readBodyString(body, "error")
    }
  });
}

function getMfaAuditAction(path: string, outcome: "success" | "failure") {
  if (path.endsWith("/two-factor/enable")) return "security.mfa.enroll.start";
  if (path.endsWith("/two-factor/verify-totp")) {
    return outcome === "success" ? "security.mfa.challenge.success" : "security.mfa.challenge.fail";
  }
  if (path.endsWith("/two-factor/verify-backup-code")) {
    return outcome === "success"
      ? "security.mfa.recovery-code.use"
      : "security.mfa.recovery-code.fail";
  }
  if (path.endsWith("/two-factor/generate-backup-codes")) {
    return "security.mfa.recovery-codes.rotate";
  }
  if (path.endsWith("/two-factor/disable")) return "security.mfa.disable";
  return null;
}

function getMfaAuditDetail(path: string, outcome: "success" | "failure") {
  const suffix = outcome === "success" ? "succeeded" : "failed";
  if (path.endsWith("/two-factor/enable")) return `MFA enrollment ${suffix}.`;
  if (path.endsWith("/two-factor/verify-totp")) return `MFA TOTP challenge ${suffix}.`;
  if (path.endsWith("/two-factor/verify-backup-code")) {
    return `MFA recovery-code challenge ${suffix}.`;
  }
  if (path.endsWith("/two-factor/generate-backup-codes")) {
    return `MFA recovery-code rotation ${suffix}.`;
  }
  if (path.endsWith("/two-factor/disable")) return `MFA disable ${suffix}.`;
  return `MFA operation ${suffix}.`;
}

function readBodyString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
