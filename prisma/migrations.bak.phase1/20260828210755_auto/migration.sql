-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT NOT NULL,
    "postalCode" TEXT,
    "unitNumber" TEXT,
    "activeCategories" TEXT NOT NULL,
    "preferences" JSONB NOT NULL,
    "onboardingProfile" JSONB,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "onboardingCompletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "acquisitionSource" TEXT NOT NULL DEFAULT 'ORGANIC',
    "acquisitionCampaignId" TEXT,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT true,
    "lastOrderAt" DATETIME,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalSpentCents" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "passwordHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FamilyMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "contactPerson" TEXT,
    "contactEmail1" TEXT,
    "contactPhone1" TEXT,
    "contactPerson2" TEXT,
    "contactEmail2" TEXT,
    "contactPhone2" TEXT,
    "companyName" TEXT,
    "companyRegNo" TEXT,
    "registeredAddress" TEXT,
    "categories" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "vendorType" TEXT NOT NULL DEFAULT 'MICRO',
    "staffCount" INTEGER NOT NULL DEFAULT 1,
    "dailyCapacity" INTEGER NOT NULL DEFAULT 6,
    "verificationData" JSONB,
    "maxTasksPerDay" INTEGER NOT NULL DEFAULT 6,
    "maxTasksPerWeek" INTEGER NOT NULL DEFAULT 30,
    "availability" JSONB,
    "zones" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "roleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vendor_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "householdId" TEXT,
    "vendorId" TEXT,
    "label" TEXT,
    "propertyType" TEXT NOT NULL DEFAULT 'HDB',
    "postalCode" TEXT NOT NULL,
    "blockNumber" TEXT,
    "streetName" TEXT,
    "buildingName" TEXT,
    "level" TEXT,
    "unitNumber" TEXT,
    "houseNumber" TEXT,
    "streetAddress" TEXT,
    "fullAddress" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "latitude" REAL,
    "longitude" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Address_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Address_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorHouseholdAffinity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "totalRating" REAL NOT NULL DEFAULT 0,
    "avgRating" REAL,
    "reassignmentCount" INTEGER NOT NULL DEFAULT 0,
    "disputeCount" INTEGER NOT NULL DEFAULT 0,
    "jobOutcomes" JSONB,
    "lastAssignedAt" DATETIME,
    "lastCompletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendorHouseholdAffinity_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VendorHouseholdAffinity_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobNo" TEXT,
    "householdId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "jobTypeId" TEXT,
    "quotationId" TEXT,
    "recurrencePattern" JSONB,
    "instructions" TEXT,
    "instructionsSource" TEXT,
    "amountCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "discountCodeId" TEXT,
    "finalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dispatchedAt" DATETIME,
    "acceptedAt" DATETIME,
    "scheduledAt" DATETIME,
    "inProgressAt" DATETIME,
    "completedAt" DATETIME,
    "verifiedAt" DATETIME,
    "escrowReleasedAt" DATETIME,
    "disputedAt" DATETIME,
    "scheduledStart" DATETIME,
    "metadata" JSONB,
    "acceptTimeoutAt" DATETIME,
    "lockAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    CONSTRAINT "Task_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_jobTypeId_fkey" FOREIGN KEY ("jobTypeId") REFERENCES "ServiceJobType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "fileSize" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "assignedStaffId" TEXT,
    "scheduledStart" DATETIME NOT NULL,
    "scheduledEnd" DATETIME,
    "actualStart" DATETIME,
    "actualEnd" DATETIME,
    "rating" INTEGER,
    "ratingComment" TEXT,
    "completionNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "dispatchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "shareToken" TEXT,
    "sharedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Booking_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "VendorStaff" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" DATETIME,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationPhoto_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VerificationPhoto_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookingAddon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "addedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookingAddon_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BookingAddon_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BookingAddon_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "FamilyMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EscrowLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "bookingId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "originalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "discountFundedBy" TEXT NOT NULL DEFAULT 'PLATFORM',
    "state" TEXT NOT NULL DEFAULT 'HELD',
    "commissionRate" REAL NOT NULL DEFAULT 10.0,
    "commissionCents" INTEGER NOT NULL,
    "vendorPayoutCents" INTEGER NOT NULL,
    "refundCents" INTEGER NOT NULL DEFAULT 0,
    "stripePaymentIntentId" TEXT,
    "stripeTransferId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heldAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" DATETIME,
    "disputedAt" DATETIME,
    "refundedAt" DATETIME,
    "disputeReason" TEXT,
    "disputeResolution" TEXT,
    "disputeResolvedBy" TEXT,
    "disputeResolvedAt" DATETIME,
    CONSTRAINT "EscrowLedger_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EscrowLedger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "escrowLedgerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedById" TEXT,
    "issuedByName" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "stripeRefundId" TEXT,
    "stripeStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_escrowLedgerId_fkey" FOREIGN KEY ("escrowLedgerId") REFERENCES "EscrowLedger" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'HOME',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priceCents" INTEGER NOT NULL DEFAULT 800,
    "stripeSubscriptionId" TEXT,
    "billingCycleStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billingCycleEnd" DATETIME,
    "nextBillingDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutonomyLevelThreshold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "cyclesRequired" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "HouseholdCategoryAutonomy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "verifiedCyclesAtLevel" INTEGER NOT NULL DEFAULT 0,
    "totalVerifiedCycles" INTEGER NOT NULL DEFAULT 0,
    "promotionPaused" BOOLEAN NOT NULL DEFAULT false,
    "lastPromotedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HouseholdCategoryAutonomy_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "memberId" TEXT,
    "vendorId" TEXT,
    "channel" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "referenceType" TEXT,
    "referenceId" TEXT,
    "externalMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" DATETIME,
    "deliveredAt" DATETIME,
    "readAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Notification_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Notification_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceJobType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "pricingRules" JSONB NOT NULL,
    "requiredFields" JSONB NOT NULL,
    "addOns" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "jobTypeId" TEXT NOT NULL,
    "fieldValues" JSONB NOT NULL,
    "selectedAddOns" JSONB NOT NULL,
    "baseCents" INTEGER NOT NULL,
    "addOnsCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "aiExplanation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Quotation_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quotation_jobTypeId_fkey" FOREIGN KEY ("jobTypeId") REFERENCES "ServiceJobType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorStaff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "jobTitle" TEXT,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendorStaff_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "jobTitle" TEXT,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "roleId" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendorUser_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VendorUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "effectiveDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorPlan_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorPlan_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorFeatureOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "VendorFeatureOverride_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VendorFeatureOverride_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Anomaly" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "taskId" TEXT,
    "bookingId" TEXT,
    "vendorId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acknowledgedAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Anomaly_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "userType" TEXT NOT NULL DEFAULT 'household',
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    PRIMARY KEY ("roleId", "permissionId"),
    CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OpsUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COORDINATOR',
    "roleId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME,
    CONSTRAINT "OpsUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "vendorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "OpsUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "appliesTo" TEXT NOT NULL DEFAULT 'BOTH',
    "targetTier" TEXT,
    "targetCategory" TEXT,
    "maxRedemptions" INTEGER,
    "redemptionsCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DiscountRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" REAL NOT NULL,
    "minOrderValueCents" INTEGER,
    "maxDiscountCapCents" INTEGER,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "eligibility" TEXT NOT NULL DEFAULT 'ANY',
    "minAutonomyLevel" INTEGER,
    "maxAutonomyLevel" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscountRule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "batchId" TEXT,
    "assignedHouseholdId" TEXT,
    "maxUses" INTEGER,
    "usesRemaining" INTEGER,
    "expiresAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountCode_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodeRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discountCodeId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "bookingId" TEXT,
    "subscriptionId" TEXT,
    "discountAppliedCents" INTEGER NOT NULL,
    "redeemedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeRedemption_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodeRedemption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "platform_config" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" DATETIME,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "revokedReason" TEXT,
    "notifiedAt" DATETIME,
    "viewedAt" DATETIME,
    CONSTRAINT "Voucher_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Voucher_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Voucher_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "filters" JSONB NOT NULL,
    "campaignId" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "lastComputedAt" DATETIME,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Segment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SegmentMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "segmentId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "reason" JSONB,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SegmentMember_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SegmentMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignAttribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "taskId" TEXT,
    "touchpoint" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "attributedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignAttribution_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "householdId" TEXT,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Household_email_key" ON "Household"("email");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMember_email_key" ON "FamilyMember"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");

-- CreateIndex
CREATE INDEX "Address_ownerType_ownerId_idx" ON "Address"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Address_ownerType_ownerId_isDefault_idx" ON "Address"("ownerType", "ownerId", "isDefault");

-- CreateIndex
CREATE INDEX "Address_postalCode_idx" ON "Address"("postalCode");

-- CreateIndex
CREATE INDEX "Address_householdId_idx" ON "Address"("householdId");

-- CreateIndex
CREATE INDEX "Address_vendorId_idx" ON "Address"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorHouseholdAffinity_householdId_vendorId_category_key" ON "VendorHouseholdAffinity"("householdId", "vendorId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Task_jobNo_key" ON "Task"("jobNo");

-- CreateIndex
CREATE UNIQUE INDEX "Task_quotationId_key" ON "Task"("quotationId");

-- CreateIndex
CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_shareToken_key" ON "Booking"("shareToken");

-- CreateIndex
CREATE INDEX "EscrowLedger_taskId_idx" ON "EscrowLedger"("taskId");

-- CreateIndex
CREATE INDEX "EscrowLedger_state_idx" ON "EscrowLedger"("state");

-- CreateIndex
CREATE INDEX "Refund_escrowLedgerId_idx" ON "Refund"("escrowLedgerId");

-- CreateIndex
CREATE INDEX "Refund_createdAt_idx" ON "Refund"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AutonomyLevelThreshold_category_level_key" ON "AutonomyLevelThreshold"("category", "level");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdCategoryAutonomy_householdId_category_key" ON "HouseholdCategoryAutonomy"("householdId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJobType_slug_key" ON "ServiceJobType"("slug");

-- CreateIndex
CREATE INDEX "ServiceJobType_category_isActive_sortOrder_idx" ON "ServiceJobType"("category", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Quotation_householdId_idx" ON "Quotation"("householdId");

-- CreateIndex
CREATE INDEX "Quotation_jobTypeId_idx" ON "Quotation"("jobTypeId");

-- CreateIndex
CREATE INDEX "VendorStaff_vendorId_idx" ON "VendorStaff"("vendorId");

-- CreateIndex
CREATE INDEX "VendorStaff_isActive_idx" ON "VendorStaff"("isActive");

-- CreateIndex
CREATE INDEX "VendorUser_vendorId_idx" ON "VendorUser"("vendorId");

-- CreateIndex
CREATE INDEX "VendorUser_isActive_idx" ON "VendorUser"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VendorUser_email_key" ON "VendorUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_key_key" ON "Feature"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_planId_featureId_key" ON "PlanFeature"("planId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPlan_vendorId_key" ON "VendorPlan"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorFeatureOverride_vendorId_featureId_key" ON "VendorFeatureOverride"("vendorId", "featureId");

-- CreateIndex
CREATE INDEX "Anomaly_householdId_status_idx" ON "Anomaly"("householdId", "status");

-- CreateIndex
CREATE INDEX "Anomaly_type_status_idx" ON "Anomaly"("type", "status");

-- CreateIndex
CREATE INDEX "Anomaly_severity_idx" ON "Anomaly"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_email_userType_idx" ON "PasswordResetToken"("email", "userType");

-- CreateIndex
CREATE UNIQUE INDEX "roles_slug_key" ON "roles"("slug");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_module_action_key" ON "permissions"("module", "action");

-- CreateIndex
CREATE UNIQUE INDEX "OpsUser_email_key" ON "OpsUser"("email");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_vendorId_idx" ON "AuditLog"("vendorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_type_idx" ON "Campaign"("type");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRule_campaignId_key" ON "DiscountRule"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");

-- CreateIndex
CREATE INDEX "DiscountCode_campaignId_idx" ON "DiscountCode"("campaignId");

-- CreateIndex
CREATE INDEX "DiscountCode_batchId_idx" ON "DiscountCode"("batchId");

-- CreateIndex
CREATE INDEX "DiscountCode_isActive_idx" ON "DiscountCode"("isActive");

-- CreateIndex
CREATE INDEX "DiscountCode_assignedHouseholdId_idx" ON "DiscountCode"("assignedHouseholdId");

-- CreateIndex
CREATE INDEX "CodeRedemption_discountCodeId_idx" ON "CodeRedemption"("discountCodeId");

-- CreateIndex
CREATE INDEX "CodeRedemption_householdId_idx" ON "CodeRedemption"("householdId");

-- CreateIndex
CREATE INDEX "CodeRedemption_campaignId_idx" ON "CodeRedemption"("campaignId");

-- CreateIndex
CREATE INDEX "Voucher_householdId_status_idx" ON "Voucher"("householdId", "status");

-- CreateIndex
CREATE INDEX "Voucher_campaignId_idx" ON "Voucher"("campaignId");

-- CreateIndex
CREATE INDEX "Voucher_status_expiresAt_idx" ON "Voucher"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_householdId_discountCodeId_key" ON "Voucher"("householdId", "discountCodeId");

-- CreateIndex
CREATE INDEX "Segment_status_idx" ON "Segment"("status");

-- CreateIndex
CREATE INDEX "Segment_campaignId_idx" ON "Segment"("campaignId");

-- CreateIndex
CREATE INDEX "SegmentMember_householdId_idx" ON "SegmentMember"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "SegmentMember_segmentId_householdId_key" ON "SegmentMember"("segmentId", "householdId");

-- CreateIndex
CREATE INDEX "CampaignAttribution_householdId_campaignId_idx" ON "CampaignAttribution"("householdId", "campaignId");

-- CreateIndex
CREATE INDEX "CampaignAttribution_campaignId_touchpoint_idx" ON "CampaignAttribution"("campaignId", "touchpoint");

-- CreateIndex
CREATE INDEX "CampaignEvent_campaignId_eventType_idx" ON "CampaignEvent"("campaignId", "eventType");

-- CreateIndex
CREATE INDEX "CampaignEvent_householdId_idx" ON "CampaignEvent"("householdId");
