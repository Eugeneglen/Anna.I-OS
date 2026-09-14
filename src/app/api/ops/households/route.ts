import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import * as bcrypt from "bcryptjs";
import { getTierPriceCents } from "@/lib/subscription-pricing";

// POST /api/ops/households — Create a new household (ops-initiated)
export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // P5 (AUDIT-4): was session-only — now requires households:create
    // (coordinator / operations / super_admin hold it; data_analyst is
    // read-only by design and is correctly denied).
    const allowed = await hasPermission(session, "households", "create");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — requires households:create" }, { status: 403 });
    }

    const body = await req.json();
    const {
      name,
      email: householdEmail,
      phone,
      address,
      postalCode,
      unitNumber,
      tier = "HOME",
      ownerName,
      ownerEmail,
      ownerPhone,
      password,
    } = body;

    // Validation
    if (!name || !householdEmail || !address || !ownerName || !ownerEmail || !password) {
      return NextResponse.json(
        { error: "Missing required fields: name, email, address, ownerName, ownerEmail, password" },
        { status: 400 }
      );
    }

    // Check for duplicate household email
    const existingHH = await db.household.findUnique({ where: { email: householdEmail } });
    if (existingHH) {
      return NextResponse.json({ error: "Household email already exists" }, { status: 409 });
    }

    // Check for duplicate member email
    const existingMember = await db.familyMember.findUnique({ where: { email: ownerEmail } });
    if (existingMember) {
      return NextResponse.json({ error: "Owner email already exists" }, { status: 409 });
    }

    // Create household + owner member + subscription in a transaction
    const household = await db.$transaction(async (tx) => {
      // 1. Create household
      const hh = await tx.household.create({
        data: {
          name,
          fullName: ownerName || null,
          email: householdEmail,
          phone: phone || null,
          address,
          postalCode: postalCode || null,
          unitNumber: unitNumber || null,
          activeCategories: "[]",
          preferences: {},
          // onboardingStep stays 0 — user needs to complete onboarding
        },
      });

      // 2. Create owner member with password
      const passwordHash = await bcrypt.hash(password, 10);
      await tx.familyMember.create({
        data: {
          householdId: hh.id,
          name: ownerName,
          email: ownerEmail,
          phone: ownerPhone || null,
          role: "OWNER",
          passwordHash,
        },
      });

      // 3. Create subscription
      await tx.subscription.create({
        data: {
          householdId: hh.id,
          tier: tier as "HOME" | "CARE",
          status: "ACTIVE",
          // ── F-5 (Item 8): the 2000 CARE outlier is dead — every tier
          // write stamps the application-authoritative module price
          // (HOME 800 / CARE 6800). This was the ONLY writer producing
          // $20 CARE rows while every display said $68.
          priceCents: getTierPriceCents((tier as "HOME" | "CARE") ?? "HOME"),
          billingCycleStart: new Date(),
          billingCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // 4. Create notification for household
      await tx.notification.create({
        data: {
          householdId: hh.id,
          channel: "EMAIL",
          eventType: "TASK_CREATED",
          title: "Welcome to Anna.I",
          body: `Your household "${name}" has been set up. Please complete the onboarding wizard to get started.`,
          recipientType: "HOUSEHOLD_MEMBER",
        },
      });

      // 5. Audit log
      await tx.auditLog.create({
        data: {
          userId: session.userId,
          userName: session.name,
          entityType: "HOUSEHOLD",
          entityId: hh.id,
          action: "CREATE",
          metadata: { name, email: householdEmail, tier, ownerName, ownerEmail },
        },
      });

      return hh;
    });

    return NextResponse.json({
      success: true,
      household: {
        id: household.id,
        name: household.name,
        email: household.email,
      },
    });
  } catch (error) {
    console.error("[/api/ops/households POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
