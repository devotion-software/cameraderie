/**
 * Development seed. Creates a demo user (via Better Auth, so the password is
 * hashed correctly and the account can actually log in) and a demo group with
 * the user as owner. Idempotent: safe to run repeatedly.
 *
 * Run with `bun run db:seed` (or `make seed`). Never run against production.
 */
import { and, eq } from 'drizzle-orm';
import { groups, memberships, user } from '@cameraderie/db';
import { auth } from './auth.js';
import { getDb, closeDb } from './db.js';
import { newId } from './ids.js';

const DEMO_EMAIL = 'demo@cameraderie.local';
const DEMO_PASSWORD = 'password123';
const DEMO_NAME = 'Demo User';
const DEMO_GROUP = 'Demo Group';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed in production (NODE_ENV=production).');
  }
  const db = getDb();

  // Create the demo user through Better Auth so the password hash matches the
  // login path. If it already exists, sign-up throws — fall back to a lookup.
  let userId: string;
  try {
    const res = await auth.api.signUpEmail({
      body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: DEMO_NAME },
    });
    userId = res.user.id;
    console.log(`Created demo user ${DEMO_EMAIL}`);
  } catch {
    const [existing] = await db.select().from(user).where(eq(user.email, DEMO_EMAIL)).limit(1);
    if (!existing) throw new Error(`Sign-up failed and no existing ${DEMO_EMAIL} found`);
    userId = existing.id;
    console.log(`Demo user ${DEMO_EMAIL} already exists`);
  }

  // Ensure a demo group owned by the demo user exists.
  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.ownerId, userId), eq(groups.name, DEMO_GROUP)))
    .limit(1);

  if (group) {
    console.log(`Demo group "${DEMO_GROUP}" already exists`);
  } else {
    const groupId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(groups).values({ id: groupId, name: DEMO_GROUP, ownerId: userId });
      await tx.insert(memberships).values({ id: newId(), groupId, userId, role: 'owner' });
    });
    console.log(`Created demo group "${DEMO_GROUP}"`);
  }

  console.log(`\nSeed complete. Log in with:\n  email:    ${DEMO_EMAIL}\n  password: ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
