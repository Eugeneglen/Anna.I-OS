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

    if (!step || step < 1 || step > 8) {
      return NextResponse.json({ error: "Invalid step. Must be 1-8." }, { status: 400 });
    }

    const household = await db.household.findUnique({
      where: { id: session.householdId },
    });

    if (!household) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 });
    }

    // Build update payload based on step
    const updateData: Record<string, unknown> = { onboardingStep: step };

    // Get existing profile or start fresh
    const existingProfile = (household.onboardingProfile as Record<string, unknown>) || {};

    switch (step) {
      case 1: {
        // Step 1: Your Home — home type, size, occupants
        updateData.onboardingProfile = {
          ...existingProfile,
          home: data,
        };
        break;
      }
      case 2: {
        // Step 2: Your People — household members, pets, schedule
        updateData.onboardingProfile = {
          ...existingProfile,
          people: data,
        };
        break;
      }
      case 3: {
        // Step 3: Pain Points — tasks, frustrations
        updateData.onboardingProfile = {
          ...existingProfile,
          painPoints: data,
        };
        break;
      }
      case 4: {
        // Step 4: Service Habits — frequency, how they find providers
        updateData.onboardingProfile = {
          ...existingProfile,
          serviceHabits: data,
        };
        break;
      }
      case 5: {
        // Step 5: Preferences & Autonomy — day, time, autonomy level
        updateData.onboardingProfile = {
          ...existingProfile,
          preferences: data,
        };
        // Also merge into household preferences for backward compat
        if (data) {
          const prefs = (household.preferences as Record<string, unknown>) || {};
          updateData.preferences = {
            ...prefs,
            preferredDay: data.preferredDay,
            preferredTime: data.preferredTime,
            notes: data.notes,
          };
        }
        break;
      }
      case 6: {
        // Step 6: Meet Anna.I — no data to save, just advance step
        break;
      }
      case 7: {
        // Step 7: Your AI, Your Control — no data to save, just advance step
        break;
      }
      case 8: {
        // Step 8: Complete — set completedAt, set step to 8
        updateData.onboardingStep = 8;
        updateData.onboardingCompletedAt = new Date();
        break;
      }
    }

    const updated = await db.household.update({
      where: { id: session.householdId },
      data: updateData,
    });

    // Create notification on completion
    if (step === 8) {
      await db.notification.create({
        data: {
          householdId: session.householdId,
          channel: "EMAIL",
          eventType: "TASK_CREATED",
          title: "Onboarding Complete — Welcome to Anna.I!",
          body: `Your household "${updated.name}" is all set up. Anna.I is now ready to help manage your home services intelligently.`,
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
        onboardingProfile: updated.onboardingProfile,
        onboardingStep: updated.onboardingStep,
        onboardingCompletedAt: updated.onboardingCompletedAt,
      },
    });
  } catch (error) {
    console.error("[/api/household/onboarding PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
