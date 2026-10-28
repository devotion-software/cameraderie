/**
 * Development seed. Creates a demo user and a demo group with the user as
 * owner. Idempotent: safe to run repeatedly.
 *
 * There's no password to set up front any more — sign in as the demo user via
 * email OTP at /login. With `RESEND_API_KEY` unset (the dev default), the
 * code is logged to the API console instead of emailed (see email.ts).
 *
 * Run with `bun run db:seed` (or `make seed`). Never run against production.
 */
import { eq, and } from 'drizzle-orm';
import { groups, memberships, user } from '@cameraderie/db';
import { getDb, closeDb } from './db.js';
import { newId } from './ids.js';

const DEMO_EMAIL = 'demo@cameraderie.local';
const DEMO_NAME = 'Demo User';
const DEMO_GROUP = 'Demo Group';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed in production (NODE_ENV=production).');
  }
  const db = getDb();

  let userId: string;
  const [existing] = await db.select().from(user).where(eq(user.email, DEMO_EMAIL)).limit(1);
  if (existing) {
    userId = existing.id;
    console.log(`Demo user ${DEMO_EMAIL} already exists`);
  } else {
    userId = newId();
    await db.insert(user).values({
      id: userId,
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      emailVerified: true,
      // Demo account pre-attests to the 18+/Terms gate so it isn't stopped by
      // the post-sign-in consent interstitial (see server.ts requireAcceptedTerms).
      acceptedTermsAt: new Date(),
    });
    console.log(`Created demo user ${DEMO_EMAIL}`);
  }

  // The demo account is a local dev convenience: make it a site admin with
  // both permissions so it can create groups/invites and manage other users'
  // permissions without a chicken-and-egg bootstrap problem.
  await db
    .update(user)
    .set({ role: 'admin', canCreateGroups: true, canInviteMembers: true })
    .where(eq(user.id, userId));

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

  console.log(`\nSeed complete. Sign in at /login with email: ${DEMO_EMAIL}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
