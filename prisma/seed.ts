import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// ═══════════════════════════════════════════════════════════
// DETERMINISTIC IDs — re-seeding always produces the same IDs
// This prevents browser state from breaking after re-seed.
// ═══════════════════════════════════════════════════════════
const IDS = {
  households: {
    tan:  'cmrn548id000kqvnzeu57kyo4',
    lim:  'cmrn548j0001kqvnzeu57kyo5',
    chen: 'cmrn548k0002kqvnzeu57kyo6',
  },
  members: {
    sarah:   'cmrn548l0003kqvnzeu57kyo7',
    david:   'cmrn548m0004kqvnzeu57kyo8',
    michelle:'cmrn548n0005kqvnzeu57kyo9',
    wei:     'cmrn548p0006kqvnzeu57kyoa',
  },
  vendors: {
    sparkclean:  'cmrn548q0007kqvnzeu57kyob',
    freshwash:  'cmrn548r0008kqvnzeu57kyoc',
    coolair:    'cmrn548s0009kqvnzeu57kyod',
    fixit:      'cmrn548t000akqvnzeu57kyoe',
    greensweep: 'cmrn548u000bkqvnzeu57kyof',
  },
  tasks: {
    verifiedClean:  'demo-task-verified-clean',
    dispatchedLaundry: 'demo-task-dispatched-laundry',
    createdAircon: 'demo-task-created-aircon',
    // Extra Tan Family demo tasks (AWAITING DISPATCH)
    tanLocksmith: 'demo-task-tan-locksmith',
    tanPainting:  'demo-task-tan-painting',
    tanAircon:    'demo-task-tan-aircon',
    tanPlumbing:  'demo-task-tan-plumbing',
    tanLaundry:   'demo-task-tan-laundry',
    tanCleaning2: 'demo-task-tan-cleaning2',
  },
  bookings: {
    verifiedClean:  'demo-booking-verified-clean',
    dispatchedLaundry: 'demo-booking-dispatched-laundry',
  },
} as const

async function main() {
  // ============ 0. CLEANUP — remove old demo data to allow safe re-seed ============
  const demoEmails = [
    'tan.family@example.com',
    'lim.residence@example.com',
    'chen.household@example.com',
  ]

  // Find any existing households (even with different IDs) to clean up
  const existingHHs = await db.household.findMany({
    where: { email: { in: demoEmails } },
    select: { id: true },
  })
  const allHhIds = [...new Set([...Object.values(IDS.households), ...existingHHs.map(h => h.id)])]
  const vendorIds = Object.values(IDS.vendors)
  const vendorEmails = ['ops@sparkclean.sg', 'hello@freshwash.sg', 'bookings@coolair.sg', 'support@fixit.sg', 'ops@greensweep.sg'] as const;

  // Delete in reverse dependency order
  await db.verificationPhoto.deleteMany({ where: { taskId: { in: Object.values(IDS.tasks) } } })
  await db.escrowLedger.deleteMany({ where: { taskId: { in: Object.values(IDS.tasks) } } })
  await db.taskAttachment.deleteMany({ where: { taskId: { in: Object.values(IDS.tasks) } } })
  await db.booking.deleteMany({ where: { taskId: { in: Object.values(IDS.tasks) } } })
  await db.task.deleteMany({ where: { OR: [
    { id: { in: Object.values(IDS.tasks) } },
    { householdId: { in: allHhIds } },
  ] } })
  await db.vendorHouseholdAffinity.deleteMany({ where: { householdId: { in: allHhIds } } })
  await db.householdCategoryAutonomy.deleteMany({ where: { householdId: { in: allHhIds } } })
  await db.subscription.deleteMany({ where: { householdId: { in: allHhIds } } })
  await db.familyMember.deleteMany({ where: { OR: [
    { id: { in: Object.values(IDS.members) } },
    { householdId: { in: allHhIds } },
  ] } })
  await db.anomaly.deleteMany({ where: { householdId: { in: allHhIds } } })
  await db.notification.deleteMany({ where: { householdId: { in: allHhIds } } })
  await db.quotation.deleteMany({ where: { householdId: { in: allHhIds } } })
  await db.household.deleteMany({ where: { email: { in: demoEmails } } })
  await db.vendor.deleteMany({ where: { OR: [
    { id: { in: vendorIds } },
    { email: { in: vendorEmails } },
  ] } })
  console.log('🧹 Cleaned up old demo data')

  // ============ 1. AUTONOMY LEVEL THRESHOLDS ============
  const categories = ['CLEANING', 'LAUNDRY', 'AIRCON', 'HANDYMAN'] as const
  const cyclesByCategory: Record<string, number> = {
    CLEANING: 2,
    LAUNDRY: 2,
    AIRCON: 3,
    HANDYMAN: 3,
  }

  for (const category of categories) {
    const cycles = cyclesByCategory[category]
    for (let level = 1; level <= 5; level++) {
      await db.autonomyLevelThreshold.upsert({
        where: { category_level: { category, level } },
        update: {},
        create: { category, level, cyclesRequired: cycles },
      })
    }
  }
  console.log('✅ Autonomy level thresholds seeded')

  // ============ 2. DEMO HOUSEHOLDS (deterministic IDs) ============

  const household1 = await db.household.upsert({
    where: { id: IDS.households.tan },
    update: {},
    create: {
      id: IDS.households.tan,
      name: 'Tan Family',
      email: 'tan.family@example.com',
      phone: '+65 9123 4567',
      address: 'Tampines Street 21, Block 123',
      postalCode: '521123',
      unitNumber: '#05-23',
      activeCategories: JSON.stringify(['CLEANING', 'LAUNDRY', 'AIRCON']),
      preferences: JSON.stringify({
        language: 'English',
        preferredDay: 'Tuesday',
        preferredTime: '10:00',
        notes: 'Dog at home — please inform vendor',
      }),
    },
  })

  const household2 = await db.household.upsert({
    where: { id: IDS.households.lim },
    update: {},
    create: {
      id: IDS.households.lim,
      name: 'Lim Residence',
      email: 'lim.residence@example.com',
      phone: '+65 8765 4321',
      address: 'Bedok North Avenue 3, Block 456',
      postalCode: '460456',
      unitNumber: '#12-01',
      activeCategories: JSON.stringify(['CLEANING', 'LAUNDRY', 'HANDYMAN']),
      preferences: JSON.stringify({
        language: 'English',
        preferredDay: 'Friday',
        preferredTime: '14:00',
        notes: 'Key with neighbour if no one home',
      }),
    },
  })

  const household3 = await db.household.upsert({
    where: { id: IDS.households.chen },
    update: {},
    create: {
      id: IDS.households.chen,
      name: 'Chen Household',
      email: 'chen.household@example.com',
      phone: '+65 9234 5678',
      address: 'Bishan Street 13, Block 789',
      postalCode: '570789',
      unitNumber: '#08-15',
      activeCategories: JSON.stringify(['CLEANING', 'LAUNDRY', 'AIRCON', 'HANDYMAN']),
      preferences: JSON.stringify({
        language: 'Mandarin',
        preferredDay: 'Monday',
        preferredTime: '09:00',
        notes: '',
      }),
    },
  })

  console.log('✅ 3 demo households created')

  // ============ 3. FAMILY MEMBERS ============

  await db.familyMember.upsert({
    where: { id: IDS.members.sarah },
    update: {},
    create: { id: IDS.members.sarah, householdId: household1.id, name: 'Sarah Tan', email: 'sarah.tan@example.com', phone: '+65 9123 4567', role: 'OWNER' },
  })
  await db.familyMember.upsert({
    where: { id: IDS.members.david },
    update: {},
    create: { id: IDS.members.david, householdId: household1.id, name: 'David Tan', email: 'david.tan@example.com', phone: '+65 9123 4568', role: 'MEMBER' },
  })
  await db.familyMember.upsert({
    where: { id: IDS.members.michelle },
    update: {},
    create: { id: IDS.members.michelle, householdId: household2.id, name: 'Michelle Lim', email: 'michelle.lim@example.com', phone: '+65 8765 4321', role: 'OWNER' },
  })
  await db.familyMember.upsert({
    where: { id: IDS.members.wei },
    update: {},
    create: { id: IDS.members.wei, householdId: household3.id, name: 'Wei Chen', email: 'wei.chen@example.com', phone: '+65 9234 5678', role: 'OWNER' },
  })

  console.log('✅ 4 family members created')

  // ============ 4. DEMO VENDORS ============

  const vendor1 = await db.vendor.upsert({
    where: { id: IDS.vendors.sparkclean },
    update: {},
    create: {
      id: IDS.vendors.sparkclean,
      name: 'SparkClean Pro', email: 'ops@sparkclean.sg', phone: '+65 9000 1111',
      categories: JSON.stringify(['CLEANING']), status: 'ACTIVE',
      verificationData: JSON.stringify({ nricVerified: true, backgroundCheckDate: '2025-01-15', certifications: ['NEA Cleaning', 'WSQ Certificate'] }),
      maxTasksPerDay: 6, maxTasksPerWeek: 28,
      availability: JSON.stringify({ workingDays: ['Mon','Tue','Wed','Thu','Fri'], workingHours: '08:00-18:00' }),
      zones: JSON.stringify(['Tampines','Bedok','Pasir Ris']),
    },
  })
  const vendor2 = await db.vendor.upsert({
    where: { id: IDS.vendors.freshwash },
    update: {},
    create: {
      id: IDS.vendors.freshwash,
      name: 'FreshWash Laundry', email: 'hello@freshwash.sg', phone: '+65 9000 2222',
      categories: JSON.stringify(['LAUNDRY']), status: 'ACTIVE',
      verificationData: JSON.stringify({ nricVerified: true, backgroundCheckDate: '2025-02-01', certifications: ['WSQ Laundry Operations'] }),
      maxTasksPerDay: 8, maxTasksPerWeek: 40,
      availability: JSON.stringify({ workingDays: ['Mon','Tue','Wed','Thu','Fri','Sat'], workingHours: '07:00-20:00' }),
      zones: JSON.stringify(['Tampines','Bedok','Bishan','Toa Payoh']),
    },
  })
  await db.vendor.upsert({
    where: { id: IDS.vendors.coolair },
    update: {},
    create: {
      id: IDS.vendors.coolair,
      name: 'CoolAir Services', email: 'bookings@coolair.sg', phone: '+65 9000 3333',
      categories: JSON.stringify(['AIRCON']), status: 'ACTIVE',
      verificationData: JSON.stringify({ nricVerified: true, backgroundCheckDate: '2025-01-20', certifications: ['BCA Aircon Servicing','NEA Registered'] }),
      maxTasksPerDay: 4, maxTasksPerWeek: 20,
      availability: JSON.stringify({ workingDays: ['Mon','Tue','Wed','Thu','Fri','Sat'], workingHours: '09:00-17:00' }),
      zones: JSON.stringify(['Tampines','Bedok','Bishan','Ang Mo Kio']),
    },
  })
  const vendor4 = await db.vendor.upsert({
    where: { id: IDS.vendors.fixit },
    update: {},
    create: {
      id: IDS.vendors.fixit,
      name: 'FixIt Handyman Co', email: 'support@fixit.sg', phone: '+65 9000 4444',
      categories: JSON.stringify(['HANDYMAN','CLEANING']), status: 'ACTIVE',
      verificationData: JSON.stringify({ nricVerified: true, backgroundCheckDate: '2025-03-01', certifications: ['BCA General Builder','WSQ Cleaning'] }),
      maxTasksPerDay: 5, maxTasksPerWeek: 25,
      availability: JSON.stringify({ workingDays: ['Mon','Tue','Wed','Thu','Fri','Sat'], workingHours: '08:00-19:00' }),
      zones: JSON.stringify(['Bedok','Bishan','Toa Payoh','Serangoon']),
    },
  })
  await db.vendor.upsert({
    where: { id: IDS.vendors.greensweep },
    update: {},
    create: {
      id: IDS.vendors.greensweep,
      name: 'GreenSweep Pte Ltd', email: 'ops@greensweep.sg', phone: '+65 9000 5555',
      categories: JSON.stringify(['CLEANING','LAUNDRY']), status: 'ACTIVE',
      verificationData: JSON.stringify({ nricVerified: true, backgroundCheckDate: '2025-02-15', certifications: ['NEA Cleaning','Eco-Certified'] }),
      maxTasksPerDay: 6, maxTasksPerWeek: 30,
      availability: JSON.stringify({ workingDays: ['Mon','Tue','Wed','Thu','Fri'], workingHours: '08:00-18:00' }),
      zones: JSON.stringify(['Tampines','Pasir Ris','Sengkang']),
    },
  })

  console.log('✅ 5 demo vendors created')

  // ============ 5. SUBSCRIPTIONS ============
  for (const hh of [household1, household2, household3]) {
    await db.subscription.create({
      data: {
        householdId: hh.id, tier: 'HOME', status: 'ACTIVE', priceCents: 800,
        billingCycleStart: new Date(), nextBillingDate: new Date(Date.now() + 30*24*60*60*1000),
      },
    })
  }
  console.log('✅ 3 subscriptions created')

  // ============ 6. HOUSEHOLD CATEGORY AUTONOMY ============
  for (const household of [household1, household2, household3]) {
    const cats = JSON.parse(household.activeCategories) as string[]
    for (const cat of cats) {
      await db.householdCategoryAutonomy.upsert({
        where: { householdId_category: { householdId: household.id, category: cat } },
        update: {},
        create: { householdId: household.id, category: cat as 'CLEANING' | 'LAUNDRY' | 'AIRCON' | 'HANDYMAN', currentLevel: 1, verifiedCyclesAtLevel: 0, totalVerifiedCycles: 0, promotionPaused: false },
      })
    }
  }
  console.log('✅ Household category autonomy records created')

  // ============ 7. DEMO TASKS ============

  // --- Completed & verified task (Tan Family) ---
  const completedTask = await db.task.upsert({
    where: { id: IDS.tasks.verifiedClean },
    update: {},
    create: {
      id: IDS.tasks.verifiedClean,
      householdId: household1.id, category: 'CLEANING', status: 'VERIFIED',
      instructions: 'Deep clean kitchen and bathrooms. Dog in the house — ring doorbell first.',
      instructionsSource: 'new', amountCents: 6800,
      createdAt: new Date(Date.now() - 7*24*60*60*1000),
      dispatchedAt: new Date(Date.now() - 7*24*60*60*1000 + 30*60*1000),
      inProgressAt: new Date(Date.now() - 7*24*60*60*1000 + 2*60*60*1000),
      completedAt: new Date(Date.now() - 7*24*60*60*1000 + 3*60*60*1000),
      verifiedAt: new Date(Date.now() - 7*24*60*60*1000 + 3.5*60*60*1000),
      escrowReleasedAt: new Date(Date.now() - 7*24*60*60*1000 + 4*60*60*1000),
    },
  })

  const completedBooking = await db.booking.upsert({
    where: { id: IDS.bookings.verifiedClean },
    update: {},
    create: {
      id: IDS.bookings.verifiedClean,
      taskId: completedTask.id, vendorId: vendor1.id,
      scheduledStart: new Date(Date.now() - 7*24*60*60*1000 + 2*60*60*1000),
      scheduledEnd: new Date(Date.now() - 7*24*60*60*1000 + 3*60*60*1000),
      actualStart: new Date(Date.now() - 7*24*60*60*1000 + 2*60*60*1000),
      actualEnd: new Date(Date.now() - 7*24*60*60*1000 + 3*60*60*1000),
      rating: 5, ratingComment: 'Excellent cleaning, very thorough!', status: 'completed',
      dispatchedAt: new Date(Date.now() - 7*24*60*60*1000 + 30*60*1000),
      acceptedAt: new Date(Date.now() - 7*24*60*60*1000 + 45*60*1000),
      completedAt: new Date(Date.now() - 7*24*60*60*1000 + 3*60*60*1000),
    },
  })

  await db.verificationPhoto.upsert({
    where: { id: 'demo-photo-1' },
    update: {},
    create: {
      id: 'demo-photo-1', taskId: completedTask.id, bookingId: completedBooking.id,
      fileUrl: '/demo/cleaning-after-1.jpg', uploadedBy: 'vendor',
      isVerified: true, verifiedBy: 'sarah.tan@example.com',
      verifiedAt: new Date(Date.now() - 7*24*60*60*1000 + 3.5*60*60*1000),
    },
  })

  await db.escrowLedger.upsert({
    where: { id: 'demo-escrow-1' },
    update: {},
    create: {
      id: 'demo-escrow-1', taskId: completedTask.id, bookingId: completedBooking.id,
      amountCents: 6800, state: 'RELEASED', commissionRate: 10.0, commissionCents: 680,
      vendorPayoutCents: 6120, releasedAt: new Date(Date.now() - 7*24*60*60*1000 + 4*60*60*1000),
    },
  })

  // --- Dispatched task (Lim Residence) ---
  const dispatchedTask = await db.task.upsert({
    where: { id: IDS.tasks.dispatchedLaundry },
    update: {},
    create: {
      id: IDS.tasks.dispatchedLaundry,
      householdId: household2.id, category: 'LAUNDRY', status: 'DISPATCHED',
      instructions: 'Wash and fold. Separate whites and colours.',
      instructionsSource: 'new', amountCents: 4500,
      createdAt: new Date(Date.now() - 2*60*60*1000),
      dispatchedAt: new Date(Date.now() - 1.5*60*60*1000),
    },
  })

  await db.booking.upsert({
    where: { id: IDS.bookings.dispatchedLaundry },
    update: {},
    create: {
      id: IDS.bookings.dispatchedLaundry,
      taskId: dispatchedTask.id, vendorId: vendor2.id,
      scheduledStart: new Date(Date.now() + 2*60*60*1000),
      scheduledEnd: new Date(Date.now() + 4*60*60*1000),
      status: 'accepted',
      dispatchedAt: new Date(Date.now() - 1.5*60*60*1000),
      acceptedAt: new Date(Date.now() - 1*60*60*1000),
    },
  })

  await db.escrowLedger.upsert({
    where: { id: 'demo-escrow-2' },
    update: {},
    create: {
      id: 'demo-escrow-2', taskId: dispatchedTask.id,
      amountCents: 4500, state: 'HELD', commissionRate: 10.0, commissionCents: 450, vendorPayoutCents: 4050,
    },
  })

  // --- Created task (Chen Household) ---
  await db.task.upsert({
    where: { id: IDS.tasks.createdAircon },
    update: {},
    create: {
      id: IDS.tasks.createdAircon,
      householdId: household3.id, category: 'AIRCON', status: 'CREATED',
      instructions: 'General servicing for 2 wall units. Filter cleaning.',
      instructionsSource: 'new', amountCents: 12000,
    },
  })

  // --- Extra Tan Family demo tasks (AWAITING DISPATCH) ---
  const tanDemoTasks = [
    { id: IDS.tasks.tanLocksmith, category: 'LOCKSMITH' as const, instructions: 'Replace front door lock with digital smart lock', amountCents: 8000, hoursAgo: 1 },
    { id: IDS.tasks.tanPainting,  category: 'PAINTING' as const,  instructions: 'Touch-up living room feature wall — light grey', amountCents: 7000, hoursAgo: 2, scheduledStart: '2026-07-30T10:00:00' },
    { id: IDS.tasks.tanAircon,    category: 'AIRCON' as const,    instructions: 'Chemical wash for 3 wall-mounted units in bedrooms', amountCents: 5000, hoursAgo: 3 },
    { id: IDS.tasks.tanPlumbing,  category: 'PLUMBING' as const,  instructions: 'Kitchen sink drain clogged — slow drainage', amountCents: 10000, hoursAgo: 5 },
    { id: IDS.tasks.tanLaundry,   category: 'LAUNDRY' as const,   instructions: 'Wash and fold — 2 weeks of accumulated laundry', amountCents: 1500, hoursAgo: 8 },
    { id: IDS.tasks.tanCleaning2, category: 'CLEANING' as const,  instructions: 'Regular maintenance cleaning for 3-bedroom condo', amountCents: 8000, hoursAgo: 12 },
  ]

  for (const t of tanDemoTasks) {
    await db.task.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        householdId: household1.id,
        category: t.category,
        status: 'CREATED',
        instructions: t.instructions,
        instructionsSource: 'new',
        amountCents: t.amountCents,
        createdAt: new Date(Date.now() - t.hoursAgo * 60 * 60 * 1000),
        ...(t.scheduledStart ? { scheduledStart: new Date(t.scheduledStart) } : {}),
      },
    })
  }

  // --- Affinity data for Tan Family + SparkClean ---
  await db.vendorHouseholdAffinity.upsert({
    where: { householdId_vendorId_category: { householdId: household1.id, vendorId: vendor1.id, category: 'CLEANING' } },
    update: {},
    create: {
      householdId: household1.id, vendorId: vendor1.id, category: 'CLEANING',
      bookingCount: 3, completedCount: 3, totalRating: 15, avgRating: 5.0,
      reassignmentCount: 0, disputeCount: 0,
      jobOutcomes: JSON.stringify([
        { bookingId: 'demo-1', outcome: 'completed', rating: 5, timestamp: new Date(Date.now() - 21*24*60*60*1000).toISOString() },
        { bookingId: 'demo-2', outcome: 'completed', rating: 5, timestamp: new Date(Date.now() - 14*24*60*60*1000).toISOString() },
        { bookingId: 'demo-3', outcome: 'completed', rating: 5, timestamp: completedBooking.completedAt?.toISOString() },
      ]),
      lastAssignedAt: new Date(Date.now() - 7*24*60*60*1000 + 30*60*1000),
      lastCompletedAt: completedBooking.completedAt,
    },
  })

  console.log('✅ Demo tasks, bookings, verification, escrow, and affinity data created')
  console.log('')
  console.log('=== SEED COMPLETE ===')
  console.log(`Households: 3 | Members: 4 | Vendors: 5`)
  console.log(`Tasks: 9 (1 verified, 1 dispatched, 7 created)`)
  console.log(`Autonomy thresholds: 20 (4 categories × 5 levels)`)
  console.log(`Subscriptions: 3 (all Home tier)`)
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())