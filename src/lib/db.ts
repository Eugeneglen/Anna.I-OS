import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

// ──────────────────────────────────────────────────────────
// Layer 1: Self-healing — ensure the database directory and file
// can be created BEFORE PrismaClient tries to connect.
//
// This alone fixes the #1 cause of "Unable to open database file"
// on both local dev and any environment where the filesystem
// isn't pre-populated.
// ──────────────────────────────────────────────────────────

function ensureDatabasePath() {
  const dbUrl = process.env.DATABASE_URL || ''

  // Only applies to SQLite (file: URLs)
  if (!dbUrl.startsWith('file:')) return

  // Extract file path from "file:/absolute/path" or "file:relative/path"
  let filePath = dbUrl.replace(/^file:/, '')
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(process.cwd(), filePath)
  }

  const dir = path.dirname(filePath)

  if (!fs.existsSync(dir)) {
    console.warn(`[db] Directory ${dir} does not exist — creating it now.`)
    fs.mkdirSync(dir, { recursive: true })
    console.log(`[db] ✅ Directory created: ${dir}`)
  }

  // If the .db file itself doesn't exist, SQLite will create it,
  // but it will be an empty database with no tables.
  // That's OK — Layer 2 (ensure-db) will handle schema sync + seed.
  if (!fs.existsSync(filePath)) {
    console.warn(`[db] Database file ${filePath} does not exist — SQLite will create an empty file on first connection.`)
    console.log(`[db]   Schema will be synced by ensure-db on startup.`)
  }
}

// Run ONCE at module load time — before any PrismaClient is created
ensureDatabasePath()

// ──────────────────────────────────────────────────────────
// PrismaClient singleton (standard Next.js pattern)
// ──────────────────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['error', 'warn']
      : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
