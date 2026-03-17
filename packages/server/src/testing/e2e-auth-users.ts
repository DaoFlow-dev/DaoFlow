export type E2EAuthUser = {
  key: string;
  name: string;
  email: string;
  password: string;
  role: "admin" | "operator" | "viewer";
};

export const e2eAuthUsers: readonly E2EAuthUser[] = [
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

export const e2eAdminUser = e2eAuthUsers[0];
