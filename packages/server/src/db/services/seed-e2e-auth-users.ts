import { eq } from "drizzle-orm";
import { auth } from "../../auth";
import { db, pool } from "../connection";
import { users } from "../schema/users";
import { e2eAuthUsers, type E2EAuthUser } from "../../testing/e2e-auth-users";

async function ensureE2EAuthUser(user: E2EAuthUser) {
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, user.email))
    .limit(1);

  if (!existingUser) {
    await auth.api.signUpEmail({
      body: {
        name: user.name,
        email: user.email,
        password: user.password
      }
    });
  }

  await db
    .update(users)
    .set({
      name: user.name,
      emailVerified: true,
      role: user.role,
      status: "active",
      updatedAt: new Date()
    })
    .where(eq(users.email, user.email));
}

async function main() {
  for (const user of e2eAuthUsers) {
    await ensureE2EAuthUser(user);
  }

  console.log(`Seeded Better Auth E2E users: ${e2eAuthUsers.map((user) => user.email).join(", ")}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
