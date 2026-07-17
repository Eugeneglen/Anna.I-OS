import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function _main() {
  // Find Tan Family household
  const tanFamily = await db.household.findFirst({ where: { name: 'Tan Family' } })
  if (!tanFamily) {
    console.error('❌ Tan Family not found — run main seed first')
    process.exit(1)
  }

  // Find SparkClean vendor
  const sparkClean = await db.vendor.findFirst({ where: { name: 'SparkClean Pro' } })
  if (!sparkClean) {
    console.error('❌ SparkClean Pro not found')
    process.exit(1)
  }

  // Find the dispatched task for Tan Family (if exists, or use completed)
  const tasks = await db.task.findMany({
    where: { householdId: tanFamily.id },
    include: { bookings: { take: 1 } },
  })

  const referenceTask = tasks.find(t => t.status === 'DISPATCHED') || tasks[0]
  const referenceBooking = referenceTask?.bookings[0]

  // Clear existing anomalies for clean demo
  const deleted = await db.anomaly.deleteMany({ where: { householdId: tanFamily.id } })
  console.log(`🗑️  Cleared ${deleted.count} existing anomalies`)

  // ─── Anomaly 1: VENDOR_LATE (MEDIUM) ───
  await db.anomaly.create({
    data: {
      householdId: tanFamily.id,
      taskId: referenceTask?.id,
      bookingId: referenceBooking?.id,
      vendorId: sparkClean.id,
      type: 'VENDOR_LATE',
      severity: 'MEDIUM',
      message: `${sparkClean.name} is 45 min late for cleaning (scheduled 10:00 AM)`,
      metadata: {
        vendorName: sparkClean.name,
        scheduledStart: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        minutesLate: 45,
        bookingStatus: 'accepted',
      },
      createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
    },
  })

  // ─── Anomaly 2: VERIFICATION_MISSING (HIGH) ───
  await db.anomaly.create({
    data: {
      householdId: tanFamily.id,
      taskId: referenceTask?.id,
      bookingId: referenceBooking?.id,
      vendorId: sparkClean.id,
      type: 'VERIFICATION_MISSING',
      severity: 'HIGH',
      message: `Verification photo missing for 26h after cleaning completion`,
      metadata: {
        category: 'CLEANING',
        completedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
        hoursSinceCompletion: 26,
        vendorName: sparkClean.name,
      },
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    },
  })

  // ─── Anomaly 3: TASK_OVERDUE (CRITICAL) ───
  await db.anomaly.create({
    data: {
      householdId: tanFamily.id,
      type: 'TASK_OVERDUE',
      severity: 'CRITICAL',
      message: `Handyman task is 5h overdue (vendor: FixIt Handyman Co)`,
      metadata: {
        category: 'HANDYMAN',
        dispatchedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        hoursOverdue: 5,
        vendorName: 'FixIt Handyman Co',
      },
      createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
    },
  })

  console.log('✅ 3 demo anomalies seeded for Tan Family:')
  console.log('   1. VENDOR_LATE (MEDIUM) — SparkClean 45min late')
  console.log('   2. VERIFICATION_MISSING (HIGH) — 26h without photo')
  console.log('   3. TASK_OVERDUE (CRITICAL) — Handyman 5h overdue')
}

export async function main() {
  await _main();
}

// Run directly when executed as a script
if (typeof require !== 'undefined' && require.main === module) {
  _main().catch(console.error).finally(() => db.$disconnect());
}