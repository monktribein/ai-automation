/**
 * Bootstraps (or promotes) a platform SUPER_ADMIN. There is deliberately no API for this.
 *   SUPER_ADMIN_EMAIL=you@company.com SUPER_ADMIN_PASSWORD='...' npm run db:seed-admin
 */
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { logger } from '../src/common/logging/logger';
import { password } from '../src/common/validation/schemas';
import { UserModel } from '../src/modules/users/user.model';
import { hashPassword } from '../src/modules/auth/auth.service';

async function main() {
  const input = z
    .object({
      SUPER_ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
      SUPER_ADMIN_PASSWORD: password,
      SUPER_ADMIN_NAME: z.string().default('Platform Admin'),
    })
    .parse(process.env);
  await connectDatabase();
  const existing = await UserModel.findOne({ email: input.SUPER_ADMIN_EMAIL });
  if (existing) {
    existing.platformRole = 'SUPER_ADMIN';
    existing.passwordHash = await hashPassword(input.SUPER_ADMIN_PASSWORD);
    await existing.save();
    logger.info({ email: input.SUPER_ADMIN_EMAIL }, 'Existing user promoted to SUPER_ADMIN');
  } else {
    await UserModel.create({
      email: input.SUPER_ADMIN_EMAIL,
      name: input.SUPER_ADMIN_NAME,
      passwordHash: await hashPassword(input.SUPER_ADMIN_PASSWORD),
      platformRole: 'SUPER_ADMIN',
    });
    logger.info({ email: input.SUPER_ADMIN_EMAIL }, 'SUPER_ADMIN created');
  }
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.fatal({ err: err instanceof z.ZodError ? err.issues : err }, 'Failed to create super admin');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
