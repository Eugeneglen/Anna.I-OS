// ============================================================
// Anna.I — Ops Marketing Shared Types
// ============================================================
// Type definitions for the Marketing module, used by the
// campaign list page, table, mobile cards, detail sheet, and
// create / generate-codes dialogs. Shapes mirror the API
// responses from /api/ops/campaigns (Phase 1, committed).
// ============================================================

export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";

export type CampaignType =
  | "FIRST_TIME"
  | "CROSS_SELL"
  | "UPGRADE"
  | "REFERRAL"
  | "PUBLIC_PROMO"
  | "OTHER";

export type CampaignAppliesTo =
  | "SUBSCRIPTION_FEE"
  | "JOB_COMMISSION"
  | "BOTH";

export type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";

export type DiscountEligibility =
  | "FIRST_TIME_HOUSEHOLD_ONLY"
  | "EXISTING_HOUSEHOLD"
  | "ANY";

export interface DiscountRule {
  id: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderValueCents?: number | null;
  maxDiscountCapCents?: number | null;
  stackable: boolean;
  eligibility: DiscountEligibility;
  minAutonomyLevel?: number | null;
  maxAutonomyLevel?: number | null;
}

export interface DiscountCode {
  id: string;
  code: string;
  batchId?: string | null;
  maxUses?: number | null;
  usesRemaining?: number | null;
  expiresAt?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CampaignListItem {
  id: string;
  name: string;
  description?: string | null;
  type: CampaignType;
  status: CampaignStatus;
  appliesTo: CampaignAppliesTo;
  targetTier?: string | null;
  targetCategory?: string | null;
  maxRedemptions?: number | null;
  redemptionsCount: number;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  createdByName: string;
  _count: { codes: number; redemptions: number };
  discountRule?: DiscountRule | null;
}

export interface CampaignDetail extends CampaignListItem {
  codes: DiscountCode[];
}

export interface CampaignStats {
  totalRedemptions: number;
  totalDiscountCents: number;
  uniqueHouseholds: number;
  sourceBreakdown: Record<string, number>;
}

export interface CampaignListResponse {
  campaigns: CampaignListItem[];
}

export interface CampaignDetailResponse {
  campaign: CampaignDetail;
  stats: CampaignStats;
}

export interface GenerateSingleResponse {
  code: DiscountCode;
}

export interface GenerateBulkResponse {
  batchId: string;
  codes: string[];
  count: number;
}
