// Anna.I TypeScript type definitions

export type ServiceCategory =
  | "CLEANING"
  | "LAUNDRY"
  | "AIRCON"
  | "PLUMBING"
  | "ELECTRICAL"
  | "PAINTING"
  | "PEST_CONTROL"
  | "HANDYMAN"
  | "LOCKSMITH"
  | "APPLIANCE_REPAIR";

export type TaskStatus =
  | "CREATED"
  | "DISPATCHED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "VERIFIED"
  | "ESCROW_RELEASED"
  | "DISPUTED";

export type EscrowState = "HELD" | "RELEASED" | "DISPUTED" | "REFUNDED";

export type RecurrencePattern =
  | "ONE_OFF"
  | "WEEKLY"
  | "FORTNIGHTLY"
  | "MONTHLY";

export interface Household {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address: string;
  postalCode?: string;
  unitNumber?: string;
  activeCategories: string;
  createdAt: string;
}

export interface FamilyMember {
  id: string;
  householdId: string;
  name: string;
  email: string;
  phone?: string;
  role: "OWNER" | "MEMBER";
}

export interface Vendor {
  id: string;
  name: string;
  email: string;
  phone: string;
  categories: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED";
}

export interface Task {
  id: string;
  householdId: string;
  category: ServiceCategory;
  status: TaskStatus;
  jobTypeId?: string | null;
  quotationId?: string | null;
  recurrencePattern?: string | null;
  instructions?: string | null;
  amountCents: number;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string | null;
  inProgressAt?: string | null;
  completedAt?: string | null;
  verifiedAt?: string | null;
  escrowReleasedAt?: string | null;
  disputedAt?: string | null;
  bookings?: Booking[];
  verificationPhotos?: VerificationPhoto[];
  escrowEntries?: EscrowLedger[];
  attachments?: TaskAttachment[];
  jobType?: { id: string; name: string; slug: string } | null;
  quotation?: { id: string; totalCents: number; breakdown: QuotationBreakdownItem[] } | null;
}

export interface Booking {
  id: string;
  taskId: string;
  vendorId: string;
  vendor?: Vendor;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  rating?: number | null;
  ratingComment?: string | null;
  status: string;
  dispatchedAt: string;
  acceptedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export interface VerificationPhoto {
  id: string;
  taskId: string;
  bookingId: string;
  fileUrl: string;
  thumbnailUrl?: string | null;
  uploadedBy: string;
  isVerified: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
}

export interface EscrowLedger {
  id: string;
  taskId: string;
  bookingId?: string | null;
  amountCents: number;
  state: EscrowState;
  commissionRate: number;
  commissionCents: number;
  vendorPayoutCents: number;
  heldAt: string;
  releasedAt?: string | null;
  disputedAt?: string | null;
  disputeReason?: string | null;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  fileType: "PHOTO" | "VIDEO";
  fileUrl: string;
  thumbnailUrl?: string | null;
  fileSize: number;
  fileName: string;
  mimeType: string;
  createdAt: string;
}

export interface HouseholdCategoryAutonomy {
  id: string;
  householdId: string;
  category: ServiceCategory;
  currentLevel: number;
  verifiedCyclesAtLevel: number;
  totalVerifiedCycles: number;
  promotionPaused: boolean;
  lastPromotedAt?: string | null;
}

export interface AutonomyLevelThreshold {
  id: string;
  category: ServiceCategory;
  level: number;
  cyclesRequired: number;
}

export interface Subscription {
  id: string;
  householdId: string;
  tier: "HOME" | "CARE";
  status: "ACTIVE" | "CANCELLED" | "PAST_DUE";
  priceCents: number;
  nextBillingDate?: string | null;
}

export type TabType = "dashboard" | "services" | "autonomy" | "activity" | "escrow" | "settings";

export const AUTONOMY_LEVELS = [
  "Manual",
  "Guided Suggestions",
  "Auto-Dispatch",
  "Predictive",
  "Full Autonomous",
] as const;

export const CATEGORY_DEFAULTS: Record<
  ServiceCategory,
  { label: string; amount: number; icon: string }
> = {
  CLEANING: { label: "Cleaning", amount: 8000, icon: "Sparkles" },
  LAUNDRY: { label: "Laundry", amount: 5000, icon: "Shirt" },
  AIRCON: { label: "Aircon", amount: 5000, icon: "Wind" },
  PLUMBING: { label: "Plumbing", amount: 10000, icon: "Droplets" },
  ELECTRICAL: { label: "Electrical", amount: 8000, icon: "Zap" },
  PAINTING: { label: "Painting", amount: 32000, icon: "Paintbrush" },
  PEST_CONTROL: { label: "Pest Control", amount: 12000, icon: "Bug" },
  HANDYMAN: { label: "Handyman", amount: 8000, icon: "Wrench" },
  LOCKSMITH: { label: "Locksmith", amount: 8000, icon: "KeyRound" },
  APPLIANCE_REPAIR: { label: "Appliance Repair", amount: 6000, icon: "Refrigerator" },
};

// ============================================================
// Anomaly Detection Types (Phase 3)
// ============================================================

export type AnomalyType =
  | "VENDOR_LATE"
  | "TASK_OVERDUE"
  | "VERIFICATION_MISSING"
  | "RATING_DROP"
  | "ESCROW_DISPUTED";

export type AnomalySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AnomalyStatus = "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";

export interface Anomaly {
  id: string;
  householdId: string;
  taskId?: string | null;
  bookingId?: string | null;
  vendorId?: string | null;
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  metadata?: Record<string, unknown> | null;
  status: AnomalyStatus;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  CREATED: "Awaiting Dispatch",
  DISPATCHED: "In Progress",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Pending Verification",
  VERIFIED: "Completed",
  ESCROW_RELEASED: "Escrow Released",
  DISPUTED: "Disputed",
};

export function formatSgd(cents: number): string {
  return `SGD $${(cents / 100).toFixed(2)}`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================
// Service Job Types & Quotation (Phase 4A)
// ============================================================

export interface ServiceJobType {
  id: string;
  category: ServiceCategory;
  name: string;
  slug: string;
  description: string;
  basePriceCents: number;
  unitLabel: string;
  pricingRules: {
    type: "flat" | "per_unit" | "per_room" | "per_item";
    unitField?: string;
    multiplierField?: string;
    areaMultiplier?: {
      field: string;
      tiers: { maxSqft: number; multiplier: number }[];
    };
    surcharges?: {
      key: string;
      label: string;
      amountCents: number;
      perUnit?: boolean;
    }[];
  };
  requiredFields: {
    key: string;
    label: string;
    type: "number" | "select";
    min?: number;
    max?: number;
    defaultValue?: number;
    options?: { label: string; value: number }[];
  }[];
  addOns: {
    key: string;
    label: string;
    priceCents: number;
    pricingType: "flat" | "per_unit" | "per_room" | "per_item";
    unitField?: string;
  }[];
  sortOrder: number;
  _count?: { quotations: number };
}

export interface QuotationBreakdownItem {
  label: string;
  amountCents: number;
}

export interface Quotation {
  id: string;
  householdId: string;
  jobTypeId: string;
  fieldValues: Record<string, number>;
  selectedAddOns: string[];
  baseCents: number;
  addOnsCents: number;
  totalCents: number;
  breakdown: QuotationBreakdownItem[];
  status: "DRAFT" | "ACCEPTED" | "REJECTED";
  createdAt: string;
}

// ============================================================
// Routing Engine Types
// ============================================================

export interface ScoreBreakdown {
  categoryMatch: boolean;
  affinityBonus: number;
  ratingBonus: number;
  disputePenalty: number;
  reassignmentPenalty: number;
  utilisationPenalty: number;
  zoneMatchBonus: number;
  recentCompletionBonus: number;
}

export interface VendorSuggestion {
  vendor: {
    id: string;
    name: string;
    email: string;
    phone: string;
    categories: string;
    status: string;
    maxTasksPerDay: number;
    zones: string;
  };
  score: number;
  scoreBreakdown: ScoreBreakdown;
  reason: string;
}