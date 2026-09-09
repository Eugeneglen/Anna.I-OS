import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getHouseholdSession } from '@/lib/household-auth'
import { getOpsSession, hasMinRole } from '@/lib/ops-auth'
import { getVendorSession } from '@/lib/vendor-auth'
import { NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/verification-photos/[id]
//
// P4 (AUDIT-4) — this route previously had NO authentication at all: any
// anonymous caller could approve/reject any photo on the platform, forge
// the `verifiedBy` audit trail via a body-supplied memberId, and (as a
// vendor) self-approve its own work — inflating the
// VendorHouseholdAffinity stats that feed the vendor-routing engine.
//
// Actor rules now enforced:
//   • Household session — must OWN the photo's task (IDOR closed). May
//     approve or reject. verifiedBy is pinned to the SESSION member id
//     (body-supplied ids are ignored).
//   • Ops session — may act on any photo (console acts on all homes) but
//     must be COORDINATOR+ (mirrors the F9 tier of POST /api/tasks/[id]/verify,
//     since photo verification is the precondition for escrow release).
//     verifiedBy is pinned to `ops:<userId>`.
//   • Vendor session — must own the booking (IDOR closed) and may only
//     REJECT. Vendors can never approve their own verification photos.
//   • Anonymous — 401.
// ─────────────────────────────────────────────────────────────────────────

const patchVerificationSchema = z.object({
  action: z.enum(['approve', 'reject']),
  // NOTE: a body-supplied `memberId` is deliberately IGNORED — `verifiedBy`
  // is derived from the authenticated session, never client input.
  rejectionReason: z.string().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: photoId } = await params
    const body = await request.json()
    const parsed = patchVerificationSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 }
      )
    }

    const { action, rejectionReason } = parsed.data

    // ── P4: resolve the actor FIRST (before any photo lookup) so
    //    unauthenticated callers always get 401 and cannot probe which
    //    photo ids exist via 404-vs-401 differences. ──
    const [householdSession, opsSession, vendorSession] = await Promise.all([
      getHouseholdSession(),
      getOpsSession(),
      getVendorSession(),
    ])

    if (!householdSession && !opsSession && !vendorSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the verification photo with task info
    const photo = await db.verificationPhoto.findUnique({
      where: { id: photoId },
      include: {
        task: true,
        booking: { include: { vendor: true } },
      },
    })

    if (!photo) {
      return NextResponse.json({ error: 'Verification photo not found' }, { status: 404 })
    }

    let verifiedBy: string | null = null

    if (householdSession) {
      // Household actor: must own the photo's task (IDOR closed)
      if (photo.task.householdId !== householdSession.householdId) {
        return NextResponse.json(
          { error: 'Forbidden — this photo belongs to another household' },
          { status: 403 }
        )
      }
      // verifiedBy pinned to the authenticated member — never client input
      verifiedBy = householdSession.memberId
    } else if (opsSession) {
      // Ops actor: COORDINATOR+ (photo verification gates escrow release —
      // same tier the console enforces on escrow actions, cf. F9)
      if (!hasMinRole(opsSession.role, 'COORDINATOR')) {
        return NextResponse.json(
          { error: 'Forbidden — verification requires an ops COORDINATOR role or above' },
          { status: 403 }
        )
      }
      verifiedBy = `ops:${opsSession.userId}`
    } else if (vendorSession) {
      // Vendor actor: must own the booking (IDOR closed)…
      if (!photo.booking || photo.booking.vendorId !== vendorSession.vendorId) {
        return NextResponse.json(
          { error: 'Forbidden — this photo belongs to another vendor' },
          { status: 403 }
        )
      }
      // …and can never approve its own work (self-approval closed)
      if (action === 'approve') {
        return NextResponse.json(
          {
            error:
              'Forbidden — vendors cannot approve their own verification photos. Only the household or ops can approve.',
          },
          { status: 403 }
        )
      }
      // Vendor may reject only; verifiedBy is not set on rejection (the
      // household is notified with the reason).
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()

    if (action === 'approve') {
      // Only household / ops actors reach this branch (vendor approve is
      // rejected above), so the affinity stats below can only be advanced
      // by the customer side or the ops console — never the vendor itself.
      // Mark photo as verified
      const updatedPhoto = await db.verificationPhoto.update({
        where: { id: photoId },
        data: {
          isVerified: true,
          verifiedAt: now,
          verifiedBy, // pinned to the session actor
        },
      })

      // ── Phase 3 · §3.4: capture the HUMAN outcome on the persisted VLM
      // record (decision-support → human outcome). The verdict itself is
      // never mutated — this only records what the human decided. Best-
      // effort: a missing verdict row (photo never analyzed) is normal. ──
      await db.photoVerification
        .updateMany({
          where: { verificationPhotoId: photoId },
          data: {
            humanOutcome: 'approved',
            humanOutcomeAt: now,
            humanOutcomeById: verifiedBy,
          },
        })
        .catch((e) => console.warn('[verification-photos] human-outcome stamp failed:', e))

      // Update VendorHouseholdAffinity
      if (photo.booking) {
        const affinityKey = {
          householdId: photo.task.householdId,
          vendorId: photo.booking.vendorId,
          category: photo.task.category,
        }
        const existingAffinity = await db.vendorHouseholdAffinity.findUnique({
          where: { householdId_vendorId_category: affinityKey },
        })

        // Parse existing job outcomes
        let jobOutcomes: Record<string, string>[] = []
        if (existingAffinity?.jobOutcomes) {
          try {
            const parsed = existingAffinity.jobOutcomes as unknown
            jobOutcomes = Array.isArray(parsed) ? parsed as Record<string, string>[] : []
          } catch {
            jobOutcomes = []
          }
        }
        jobOutcomes.push({ bookingId: photo.booking.id, outcome: 'verified', at: now.toISOString() })

        const newCompletedCount = (existingAffinity?.completedCount ?? 0) + 1
        const oldTotalRating = existingAffinity?.totalRating ?? 0
        const bookingRating = photo.booking.rating ?? 0
        const newTotalRating = oldTotalRating + bookingRating
        const newAvgRating = newCompletedCount > 0 ? newTotalRating / newCompletedCount : null

        if (existingAffinity) {
          await db.vendorHouseholdAffinity.update({
            where: { householdId_vendorId_category: affinityKey },
            data: {
              completedCount: newCompletedCount,
              totalRating: newTotalRating,
              avgRating: newAvgRating,
              jobOutcomes,
              lastCompletedAt: now,
            },
          })
        } else {
          await db.vendorHouseholdAffinity.create({
            data: {
              ...affinityKey,
              completedCount: newCompletedCount,
              totalRating: newTotalRating,
              avgRating: newAvgRating,
              jobOutcomes,
              lastCompletedAt: now,
            },
          })
        }
      }

      // Note: We do NOT call checkAndPromoteAutonomy() here.
      // The canonical flow uses POST /api/tasks/[id]/verify (bulk verify) which handles autonomy.
      // Calling it here too would cause double-counting (C-4 fix).

      return NextResponse.json({ verificationPhoto: updatedPhoto })
    }

    // REJECT
    const updatedPhoto = await db.verificationPhoto.update({
      where: { id: photoId },
      data: { rejectionReason: rejectionReason ?? null },
    })

    // ── Phase 3 · §3.4: capture the HUMAN rejection outcome on the VLM
    // record (vendor rejections land here too — the actor label carries
    // the vendor identity from the session). ──
    const rejectOutcomeById = vendorSession
      ? `vendor:${vendorSession.vendorId}`
      : verifiedBy // household actor (ops cannot reject — see branch above)
    await db.photoVerification
      .updateMany({
        where: { verificationPhotoId: photoId },
        data: {
          humanOutcome: 'rejected',
          humanOutcomeAt: now,
          humanOutcomeById: rejectOutcomeById,
        },
      })
      .catch((e) => console.warn('[verification-photos] human-outcome stamp failed:', e))

    // Notify household members
    const members = await db.familyMember.findMany({
      where: { householdId: photo.task.householdId },
      select: { id: true },
    })

    for (const member of members) {
      await db.notification.create({
        data: {
          householdId: photo.task.householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: member.id,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.VERIFICATION_REJECTED,
          title: 'Verification Rejected',
          body: `The verification photo for your ${photo.task.category.toLowerCase()} task was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
          status: NotificationStatus.PENDING,
          referenceType: 'task',
          referenceId: photo.taskId,
        },
      })
    }

    return NextResponse.json({ verificationPhoto: updatedPhoto })
  } catch (error) {
    console.error('PATCH /api/verification-photos/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to process verification photo' },
      { status: 500 }
    )
  }
}
