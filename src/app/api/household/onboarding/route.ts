import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";

// PATCH /api/household/onboarding — Save onboarding step data
export async function PATCH(req: NextRequest) {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { step, data } = body;

    if (!step || step < 1 || step > 5) {
      return NextResponse.json({ error: "Invalid step. Must be 1-5." }, { status: 400 });
    }

    const household = await db.household.findUnique({
      where: { id: session.householdId },
    });

    if (!household) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 });
    }

    // Update based on step
    const updateData: Record<string, unknown> = { onboardingStep: step };

    switch (step) {
      case 1: {
        // Profile: name, phone, email
        if (data.name) updateData.name = data.name;
        if (data.phone !== undefined) updateData.phone = data.phone;
        if (data.email) updateData.email = data.email;
        break;
      }
      case 2: {
        // Address details
        if (data.address) updateData.address = data.address;
        if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;
        if (data.unitNumber !== undefined) updateData.unitNumber = data.unitNumber;
        break;
      }
      case 3: {
        // Service categories
        if (Array.isArray(data.activeCategories)) {
          const validCategories = ["CLEANING","LAUNDRY","AIRCON","PLUMBING","ELECTRICAL","PAINTING","PEST_CONTROL","HANDYMAN","LOCKSMITH","APPLIANCE_REPAIR"];
          const filtered = data.activeCategories.filter((c: string) => validCategories.includes(c));
          updateData.activeCategories = JSON.stringify(filtered);

          // Create autonomy records for each selected category at Level 1
          for (const cat of filtered) {
            await db.householdCategoryAutonomy.upsert({
              where: {
                householdId_category: {
                  householdId: session.householdId,
                  category: cat as "CLEANING" | "LAUNDRY" | "AIRCON" | "PLUMBING" | "ELECTRICAL" | "PAINTING" | "PEST_CONTROL" | "HANDYMAN" | "LOCKSMITH" | "APPLIANCE_REPAIR",
                },
              },
              update: {},
              create: {
                householdId: session.householdId,
                category: cat as "CLEANING" | "LAUNDRY" | "AIRCON" | "PLUMBING" | "ELECTRICAL" | "PAINTING" | "PEST_CONTROL" | "HANDYMAN" | "LOCKSMITH" | "APPLIANCE_REPAIR",
                currentLevel: 1,
              },
            });
          }
        }
        break;
      }
      case 4: {
        // Preferences
        if (data.preferences) {
          updateData.preferences = {
            ...(household.preferences as Record<string, unknown> || {}),
            ...data.preferences,
          };
        }
        break;
      }
      case 5: {
        // Complete onboarding — also merge preferences if provided
        if (data.preferences) {
          updateData.preferences = {
            ...(household.preferences as Record<string, unknown> || {}),
            ...data.preferences,
          };
        }
        updateData.onboardingStep = 5;
        updateData.onboardingCompletedAt = new Date();
        break;
      }
    }

    const updated = await db.household.update({
      where: { id: session.householdId },
      data: updateData,
    });

    // Create notification on completion
    if (step === 5) {
      await db.notification.create({
        data: {
          householdId: session.householdId,
          channel: "EMAIL",
          eventType: "TASK_CREATED",
          title: "Onboarding Complete",
          body: `Welcome aboard! Your household "${updated.name}" is all set up. Start booking services now.`,
          recipientType: "HOUSEHOLD_MEMBER",
        },
      });
    }

    return NextResponse.json({
      success: true,
      step: updated.onboardingStep,
      household: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        address: updated.address,
        postalCode: updated.postalCode,
        unitNumber: updated.unitNumber,
        activeCategories: updated.activeCategories,
        preferences: updated.preferences,
        onboardingStep: updated.onboardingStep,
        onboardingCompletedAt: updated.onboardingCompletedAt,
      },
    });
  } catch (error) {
    console.error("[/api/household/onboarding PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
