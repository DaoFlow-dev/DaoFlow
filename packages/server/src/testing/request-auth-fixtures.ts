import { getEffectiveTokenCapabilities, type ApiTokenScope } from "@daoflow/shared";
import type { AuthSession } from "../auth";
import type { RequestAuthContext } from "../context";

type SeededSessionActor = {
  id: string;
  email: string;
  name: string;
};

type CustomSessionInput = {
  id: string;
  email: string;
  name: string;
  role: string;
};

const seededSessionActors = {
  owner: {
    id: "user_foundation_owner",
    email: "owner@daoflow.local",
    name: "Foundation Owner"
  },
  admin: {
    id: "user_foundation_owner",
    email: "owner@daoflow.local",
    name: "Foundation Owner"
  },
  viewer: {
    id: "user_foundation_owner",
    email: "owner@daoflow.local",
    name: "Foundation Owner"
  },
  operator: {
    id: "user_foundation_operator",
    email: "operator@daoflow.local",
    name: "Foundation Operator"
  },
  developer: {
    id: "user_developer",
    email: "developer@daoflow.local",
    name: "Foundation Developer"
  },
  agent: {
    id: "user_observer_agent",
    email: "observer-agent@daoflow.local",
    name: "Observer Agent"
  }
} as const satisfies Record<string, SeededSessionActor>;

function buildSession(input: CustomSessionInput): NonNullable<AuthSession> {
  return {
    user: {
      id: input.id,
      email: input.email,
      name: input.name,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      image: null,
      role: input.role
    },
    session: {
      id: `session_${input.id}`,
      userId: input.id,
      expiresAt: new Date(),
      token: `token_${input.id}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null
    }
  } as NonNullable<AuthSession>;
}

export function makeSession(role: string): NonNullable<AuthSession> {
  const actor =
    seededSessionActors[role as keyof typeof seededSessionActors] ?? seededSessionActors.viewer;

  return buildSession({
    ...actor,
    role
  });
}

export function makeCustomSession(input: CustomSessionInput): NonNullable<AuthSession> {
  return buildSession(input);
}

export function makeTokenAuthContext(
  role: "owner" | "agent",
  scopes: ApiTokenScope[],
  principalType: "user" | "agent" = "user"
): RequestAuthContext {
  return {
    method: "api-token",
    role,
    capabilities: getEffectiveTokenCapabilities(role, scopes),
    principal: {
      id: principalType === "agent" ? "principal_observer_agent_1" : "user_foundation_owner",
      email: principalType === "agent" ? "observer-agent@daoflow.local" : "owner@daoflow.local",
      name: principalType === "agent" ? "Observer Agent" : "Foundation Owner",
      type: principalType,
      linkedUserId: principalType === "agent" ? "user_observer_agent" : "user_foundation_owner"
    },
    token: {
      id: principalType === "agent" ? "token_observer_readonly" : "token_owner_scoped",
      name: principalType === "agent" ? "readonly-observer" : "owner-scoped",
      prefix: principalType === "agent" ? "df_read_4f39" : "dfl_owner_1",
      expiresAt: null,
      scopes
    }
  };
}
