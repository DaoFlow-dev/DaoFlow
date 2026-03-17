import type { db } from "../../connection";

export type SeedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
