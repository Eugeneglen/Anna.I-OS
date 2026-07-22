/**
 * Shared PrismaClient singleton for all seed scripts.
 *
 * Without this, seed.ts + 3 sub-scripts each create their own
 * PrismaClient (4 connection pools in one process). On Railway's
 * Postgres this triggers "sorry, too many clients already".
 *
 * Node.js caches modules per-process, so every seed script that
 * imports from "./seed-db" gets the exact same instance.
 */

import { PrismaClient } from '@prisma/client'

const globalForSeed = globalThis as unknown as { seedDb: PrismaClient | undefined }

export const db = globalForSeed.seedDb ?? new PrismaClient()

if (!globalForSeed.seedDb) globalForSeed.seedDb = db