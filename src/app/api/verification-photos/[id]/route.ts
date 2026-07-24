import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from '@prisma/client'

const patchVerificationSchema = z.object({
  action: z.enum(['approve', 'reject']),
  memberId: z.string().optional(),
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

    const { action, memberId, rejectionReason } = parsed.data

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

    const now = new Date()

    if (action === 'approve') {
      // Mark photo as verified
      const updatedPhoto = await db.verificationPhoto.update({
        where: { id: photoId },
        data: {
          isVerified: true,
          verifiedAt: now,
          verifiedBy: memberId ?? null,
        },
      })

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