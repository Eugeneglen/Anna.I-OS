// ============================================================
// Anna.I — Autonomy Promotion Helper
// ============================================================

import { db } from '@/lib/db'
import { ServiceCategory, NotificationEventType, NotificationChannel, RecipientType, NotificationStatus } from '@prisma/client'
import { MAX_AUTONOMY_LEVEL, AUTONOMY_LEVEL_NAMES } from './constants'

/**
 * Check if the household's autonomy level should be promoted for a given category.
 * Called after verification approval.
 *
 * Logic:
 * 1. Get HouseholdCategoryAutonomy for (householdId, category)
 * 2. If promotionPaused, skip
 * 3. Increment verifiedCyclesAtLevel and totalVerifiedCycles
 * 4. Get AutonomyLevelThreshold for (category, currentLevel + 1)
 * 5. If verifiedCyclesAtLevel >= cyclesRequired AND currentLevel < 5:
 *    - Increment currentLevel
 *    - Reset verifiedCyclesAtLevel to 0
 *    - Set lastPromotedAt = now()
 *    - Create Notification (AUTONOMY_PROMOTED)
 * 6. Save changes
 */
export async function checkAndPromoteAutonomy(
  householdId: string,
  category: ServiceCategory
) {
  const autonomy = await db.householdCategoryAutonomy.findUnique({
    where: {
      householdId_category: { householdId, category },
    },
  })

  if (!autonomy) return null

  // If promotion is paused, do nothing
  if (autonomy.promotionPaused) return autonomy

  // Increment cycle counters
  const updatedAutonomy = await db.householdCategoryAutonomy.update({
    where: {
      householdId_category: { householdId, category },
    },
    data: {
      verifiedCyclesAtLevel: autonomy.verifiedCyclesAtLevel + 1,
      totalVerifiedCycles: autonomy.totalVerifiedCycles + 1,
    },
  })

  // Already at max level — nothing to promote
  if (updatedAutonomy.currentLevel >= MAX_AUTONOMY_LEVEL) {
    return updatedAutonomy
  }

  // Get threshold for the NEXT level
  const nextLevel = updatedAutonomy.currentLevel + 1
  const threshold = await db.autonomyLevelThreshold.findUnique({
    where: {
      category_level: { category, level: nextLevel },
    },
  })

  if (!threshold) return updatedAutonomy

  // Check if enough cycles to promote
  if (updatedAutonomy.verifiedCyclesAtLevel >= threshold.cyclesRequired) {
    const promoted = await db.householdCategoryAutonomy.update({
      where: {
        householdId_category: { householdId, category },
      },
      data: {
        currentLevel: nextLevel,
        verifiedCyclesAtLevel: 0,
        lastPromotedAt: new Date(),
      },
    })

    // Notify all household members
    const members = await db.familyMember.findMany({
      where: { householdId },
      select: { id: true },
    })

    const levelName = AUTONOMY_LEVEL_NAMES[nextLevel - 1] ?? `Level ${nextLevel}`

    for (const member of members) {
      await db.notification.create({
        data: {
          householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: member.id,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.AUTONOMY_PROMOTED,
          title: 'Autonomy Level Up!',
          body: `Your ${category.toLowerCase()} service has been promoted to ${levelName}.`,
          status: NotificationStatus.PENDING,
          referenceType: 'autonomy',
          referenceId: promoted.id,
        },
      })
    }

    return promoted
  }

  return updatedAutonomy
}