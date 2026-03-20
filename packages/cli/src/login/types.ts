export interface LoginResponseBody {
  token?: string;
  message?: string;
  error?: string;
}

export interface DeviceStartResponse {
  ok: boolean;
  requestId: string;
  userCode: string;
  pollToken: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresAt: string;
}

export interface DeviceStatusResponse {
  ok: boolean;
  status: "pending" | "approved";
  exchangeCode: string | null;
}

export interface DeviceExchangeResponse {
  ok: boolean;
  token?: string;
  error?: string;
}

export type LoginAuthMode = "token" | "email-password" | "sso";

export interface LoginAuthResult {
  authMode: LoginAuthMode;
  sessionToken: string;
}

export interface CredentialValidationResult {
  ok: boolean;
  authMethod: "session" | "api-token";
  principalEmail: string | null;
  role: string | null;
}
