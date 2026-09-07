import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signServeUrl } from "@/lib/serve-auth";
import { isShareLinkExpired, shareLinkExpiredError } from "@/lib/share-link";

// FIX-1a: /api/serve now requires a session or a signed access token.
// This is the PUBLIC job-share data API (no session), so every
// /api/serve URL it returns is signed with a short TTL. The vendor
// logo (avatar) gets a longer TTL so the page stays presentable if
// data is refetched later; task attachments are short-lived.
const ATTACHMENT_TTL_SECONDS = 10 * 60; // 10 minutes
const AVATAR_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const booking = await db.booking.findUnique({
      where: { shareToken: token },
      include: {
        task: {
          include: {
            household: { select: { name: true, address: true, unitNumber: true } },
            jobType: { select: { name: true, description: true } },
            attachments: { select: { id: true, fileType: true, fileUrl: true, thumbnailUrl: true, fileName: true } },
          },
        },
        vendor: {
          select: {
            name: true,
            companyName: true,
            avatarUrl: true,
            phone: true,
          },
        },
        assignedStaff: {
          select: {
            name: true,
            role: true,
            contact: true,
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Link not found or expired" },
        { status: 404 }
      );
    }

    // P8 (AUDIT-4): share links were immortal — enforce a TTL from the
    // generation timestamp so leaked links stop exposing job data forever.
    if (isShareLinkExpired(booking)) {
      return NextResponse.json(
        { error: shareLinkExpiredError() },
        { status: 410 }
      );
    }

    return NextResponse.json({
      booking: {
        id: booking.id,
        status: booking.status,
        scheduledStart: booking.scheduledStart,
        scheduledEnd: booking.scheduledEnd,
        actualStart: booking.actualStart,
        actualEnd: booking.actualEnd,
        category: booking.task.category,
        instructions: booking.task.instructions,
        amountCents: booking.task.amountCents,
        discountCents: booking.task.discountCents,
        finalAmountCents: booking.task.finalAmountCents,
        jobNo: booking.task.jobNo,
        taskStatus: booking.task.status,
        address: booking.task.household?.address || null,
        unitNumber: booking.task.household?.unitNumber || null,
        householdName: booking.task.household?.name || null,
        serviceName: booking.task.jobType?.name || null,
        serviceDescription: booking.task.jobType?.description || null,
        vendorName: booking.vendor.companyName || booking.vendor.name,
        vendorLogo: signServeUrl(booking.vendor.avatarUrl, AVATAR_TTL_SECONDS) || null,
        vendorPhone: booking.vendor.phone || null,
        staffName: booking.assignedStaff?.name || null,
        staffRole: booking.assignedStaff?.role || null,
        staffContact: booking.assignedStaff?.contact || null,
        // Customer-uploaded attachments (photos/videos from household) —
        // signed for sessionless access by the share-page viewer
        customerAttachments: booking.task.attachments.map((att) => ({
          ...att,
          fileUrl: signServeUrl(att.fileUrl, ATTACHMENT_TTL_SECONDS) ?? att.fileUrl,
          thumbnailUrl: signServeUrl(att.thumbnailUrl, ATTACHMENT_TTL_SECONDS) ?? null,
        })),
      },
    });
  } catch (error) {
    console.error("GET /api/j/share/[token] error:", error);
    return NextResponse.json(
      { error: "Failed to load job details" },
      { status: 500 }
    );
  }
}
