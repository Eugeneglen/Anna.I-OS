import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // ============ 1. AUTONOMY LEVEL THRESHOLDS (Section 1a) ============
  // Cleaning/Laundry: 2 cycles per level (high frequency, faster signal)
  // Aircon/Handyman: 3 cycles per level (lower frequency, ad hoc)

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

  // ============ 2. DEMO HOUSEHOLDS ============

  const household1 = await db.household.create({
    data: {
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

  const household2 = await db.household.create({
    data: {
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

  const household3 = await db.household.create({
    data: {
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

  await db.familyMember.create({
    data: {
      householdId: household1.id,
      name: 'Sarah Tan',
      email: 'sarah.tan@example.com',
      phone: '+65 9123 4567',
      role: 'OWNER',
    },
  })

  await db.familyMember.create({
    data: {
      householdId: household1.id,
      name: 'David Tan',
      email: 'david.tan@example.com',
      phone: '+65 9123 4568',
      role: 'MEMBER',
    },
  })

  await db.familyMember.create({
    data: {
      householdId: household2.id,
      name: 'Michelle Lim',
      email: 'michelle.lim@example.com',
      phone: '+65 8765 4321',
      role: 'OWNER',
    },
  })

  await db.familyMember.create({
    data: {
      householdId: household3.id,
      name: 'Wei Chen',
      email: 'wei.chen@example.com',
      phone: '+65 9234 5678',
      role: 'OWNER',
    },
  })

  console.log('✅ 4 family members created')

  // ============ 4. DEMO VENDORS ============

  const vendor1 = await db.vendor.create({
    data: {
      name: 'SparkClean Pro',
      email: 'ops@sparkclean.sg',
      phone: '+65 9000 1111',
      categories: JSON.stringify(['CLEANING']),
      status: 'ACTIVE',
      verificationData: JSON.stringify({
        nricVerified: true,
        backgroundCheckDate: '2025-01-15',
        certifications: ['NEA Cleaning', 'WSQ Certificate'],
      }),
      maxTasksPerDay: 6,
      maxTasksPerWeek: 28,
      availability: JSON.stringify({
        workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        workingHours: '08:00-18:00',
      }),
      zones: JSON.stringify(['Tampines', 'Bedok', 'Pasir Ris']),
    },
  })

  const vendor2 = await db.vendor.create({
    data: {
      name: 'FreshWash Laundry',
      email: 'hello@freshwash.sg',
      phone: '+65 9000 2222',
      categories: JSON.stringify(['LAUNDRY']),
      status: 'ACTIVE',
      verificationData: JSON.stringify({
        nricVerified: true,
        backgroundCheckDate: '2025-02-01',
        certifications: ['WSQ Laundry Operations'],
      }),
      maxTasksPerDay: 8,
      maxTasksPerWeek: 40,
      availability: JSON.stringify({
        workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        workingHours: '07:00-20:00',
      }),
      zones: JSON.stringify(['Tampines', 'Bedok', 'Bishan', 'Toa Payoh']),
    },
  })

  const vendor3 = await db.vendor.create({
    data: {
      name: 'CoolAir Services',
      email: 'bookings@coolair.sg',
      phone: '+65 9000 3333',
      categories: JSON.stringify(['AIRCON']),
      status: 'ACTIVE',
      verificationData: JSON.stringify({
        nricVerified: true,
        backgroundCheckDate: '2025-01-20',
        certifications: ['BCA Aircon Servicing', 'NEA Registered'],
      }),
      maxTasksPerDay: 4,
      maxTasksPerWeek: 20,
      availability: JSON.stringify({
        workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        workingHours: '09:00-17:00',
      }),
      zones: JSON.stringify(['Tampines', 'Bedok', 'Bishan', 'Ang Mo Kio']),
    },
  })

  const vendor4 = await db.vendor.create({
    data: {
      name: 'FixIt Handyman Co',
      email: 'support@fixit.sg',
      phone: '+65 9000 4444',
      categories: JSON.stringify(['HANDYMAN', 'CLEANING']),
      status: 'ACTIVE',
      verificationData: JSON.stringify({
        nricVerified: true,
        backgroundCheckDate: '2025-03-01',
        certifications: ['BCA General Builder', 'WSQ Cleaning'],
      }),
      maxTasksPerDay: 5,
      maxTasksPerWeek: 25,
      availability: JSON.stringify({
        workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        workingHours: '08:00-19:00',
      }),
      zones: JSON.stringify(['Bedok', 'Bishan', 'Toa Payoh', 'Serangoon']),
    },
  })

  const vendor5 = await db.vendor.create({
    data: {
      name: 'GreenSweep Pte Ltd',
      email: 'ops@greensweep.sg',
      phone: '+65 9000 5555',
      categories: JSON.stringify(['CLEANING', 'LAUNDRY']),
      status: 'ACTIVE',
      verificationData: JSON.stringify({
        nricVerified: true,
        backgroundCheckDate: '2025-02-15',
        certifications: ['NEA Cleaning', 'Eco-Certified'],
      }),
      maxTasksPerDay: 6,
      maxTasksPerWeek: 30,
      availability: JSON.stringify({
        workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        workingHours: '08:00-18:00',
      }),
      zones: JSON.stringify(['Tampines', 'Pasir Ris', 'Sengkang']),
    },
  })

  console.log('✅ 5 demo vendors created')

  // ============ 5. SUBSCRIPTIONS ============

  await db.subscription.create({
    data: {
      householdId: household1.id,
      tier: 'HOME',
      status: 'ACTIVE',
      priceCents: 800,
      billingCycleStart: new Date(),
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })

  await db.subscription.create({
    data: {
      householdId: household2.id,
      tier: 'HOME',
      status: 'ACTIVE',
      priceCents: 800,
      billingCycleStart: new Date(),
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })

  await db.subscription.create({
    data: {
      householdId: household3.id,
      tier: 'HOME',
      status: 'ACTIVE',
      priceCents: 800,
      billingCycleStart: new Date(),
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })

  console.log('✅ 3 subscriptions created')

  // ============ 6. HOUSEHOLD CATEGORY AUTONOMY ============

  for (const household of [household1, household2, household3]) {
    const cats = JSON.parse(household.activeCategories) as string[]
    for (const cat of cats) {
      await db.householdCategoryAutonomy.create({
        data: {
          householdId: household.id,
          category: cat as 'CLEANING' | 'LAUNDRY' | 'AIRCON' | 'HANDYMAN',
          currentLevel: 1,
          verifiedCyclesAtLevel: 0,
          totalVerifiedCycles: 0,
          promotionPaused: false,
        },
      })
    }
  }

  console.log('✅ Household category autonomy records created')

  // ============ 7. DEMO TASK (in various states for UI demo) ============

  // Completed & verified task (for Tan Family)
  const completedTask = await db.task.create({
    data: {
      householdId: household1.id,
      category: 'CLEANING',
      status: 'VERIFIED',
      instructions: 'Deep clean kitchen and bathrooms. Dog in the house — ring doorbell first.',
      instructionsSource: 'new',
      amountCents: 6800,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      dispatchedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      inProgressAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
      verifiedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 3.5 * 60 * 60 * 1000),
      escrowReleasedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
    },
  })

  // Booking for completed task
  const completedBooking = await db.booking.create({
    data: {
      taskId: completedTask.id,
      vendorId: vendor1.id,
      scheduledStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      scheduledEnd: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
      actualStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      actualEnd: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
      rating: 5,
      ratingComment: 'Excellent cleaning, very thorough!',
      status: 'completed',
      dispatchedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      acceptedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
      completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
    },
  })

  // Verification photo for completed task
  await db.verificationPhoto.create({
    data: {
      taskId: completedTask.id,
      bookingId: completedBooking.id,
      fileUrl: '/demo/cleaning-after-1.jpg',
      uploadedBy: 'vendor',
      isVerified: true,
      verifiedBy: 'sarah.tan@example.com',
      verifiedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 3.5 * 60 * 60 * 1000),
    },
  })

  // Escrow for completed task
  await db.escrowLedger.create({
    data: {
      taskId: completedTask.id,
      bookingId: completedBooking.id,
      amountCents: 6800,
      state: 'RELEASED',
      commissionRate: 10.0,
      commissionCents: 680,
      vendorPayoutCents: 6120,
      releasedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
    },
  })

  // Dispatched task (in progress — Lim Residence)
  const dispatchedTask = await db.task.create({
    data: {
      householdId: household2.id,
      category: 'LAUNDRY',
      status: 'DISPATCHED',
      instructions: 'Wash and fold. Separate whites and colours.',
      instructionsSource: 'new',
      amountCents: 4500,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      dispatchedAt: new Date(Date.now() - 1.5 * 60 * 60 * 1000),
    },
  })

  await db.booking.create({
    data: {
      taskId: dispatchedTask.id,
      vendorId: vendor2.id,
      scheduledStart: new Date(Date.now() + 2 * 60 * 60 * 1000),
      scheduledEnd: new Date(Date.now() + 4 * 60 * 60 * 1000),
      status: 'accepted',
      dispatchedAt: new Date(Date.now() - 1.5 * 60 * 60 * 1000),
      acceptedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    },
  })

  // Escrow held for dispatched task
  await db.escrowLedger.create({
    data: {
      taskId: dispatchedTask.id,
      amountCents: 4500,
      state: 'HELD',
      commissionRate: 10.0,
      commissionCents: 450,
      vendorPayoutCents: 4050,
    },
  })

  // Created task (awaiting dispatch — Chen Household)
  const createdTask = await db.task.create({
    data: {
      householdId: household3.id,
      category: 'AIRCON',
      status: 'CREATED',
      instructions: 'General servicing for 2 wall units. Filter cleaning.',
      instructionsSource: 'new',
      amountCents: 12000,
    },
  })

  // Affinity data for Tan Family + SparkClean
  await db.vendorHouseholdAffinity.create({
    data: {
      householdId: household1.id,
      vendorId: vendor1.id,
      category: 'CLEANING',
      bookingCount: 3,
      completedCount: 3,
      totalRating: 15,
      avgRating: 5.0,
      reassignmentCount: 0,
      disputeCount: 0,
      jobOutcomes: JSON.stringify([
        { bookingId: 'demo-1', outcome: 'completed', rating: 5, timestamp: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString() },
        { bookingId: 'demo-2', outcome: 'completed', rating: 5, timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() },
        { bookingId: 'demo-3', outcome: 'completed', rating: 5, timestamp: completedBooking.completedAt?.toISOString() },
      ]),
      lastAssignedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      lastCompletedAt: completedBooking.completedAt,
    },
  })

  console.log('✅ Demo tasks, bookings, verification, escrow, and affinity data created')
  console.log('')
  console.log('=== SEED COMPLETE ===')
  console.log(`Households: 3 | Members: 4 | Vendors: 5`)
  console.log(`Tasks: 3 (1 verified, 1 dispatched, 1 created)`)
  console.log(`Autonomy thresholds: 20 (4 categories × 5 levels)`)
  console.log(`Subscriptions: 3 (all Home tier)`)
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())