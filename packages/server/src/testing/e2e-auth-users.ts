export type E2EAuthUser = {
  key: string;
  name: string;
  email: string;
  password: string;
  role: "owner" | "admin" | "operator" | "viewer";
};

export const e2eAuthUsers: readonly E2EAuthUser[] = [
  {
    key: "owner",
    name: "E2E Owner",
    email: "e2e-owner@daoflow.local",
    password: "owner-e2e-pass-2026",
    role: "owner"
  },
  {
    key: "admin",
    name: "E2E Admin",
    email: "e2e-admin@daoflow.local",
    password: "admin-e2e-pass-2026",
    role: "admin"
  },
  {
    key: "operator",
    name: "E2E Operator",
    email: "e2e-operator@daoflow.local",
    password: "operator-e2e-pass-2026",
    role: "operator"
  },
  {
    key: "viewer",
    name: "E2E Viewer",
    email: "e2e-viewer@daoflow.local",
    password: "viewer-e2e-pass-2026",
    role: "viewer"
  }
];

export const e2eOwnerUser = e2eAuthUsers[0];
export const e2eAdminUser = e2eAuthUsers[1];
export const e2eOperatorUser = e2eAuthUsers[2];
