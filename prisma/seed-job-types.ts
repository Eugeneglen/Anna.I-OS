import { PrismaClient, ServiceCategory } from "@prisma/client";

const db = new PrismaClient();

// ─── Shared field definitions ───

const floorAreaField = {
  key: "floorArea",
  label: "Floor Area",
  type: "select" as const,
  options: [
    { label: "Below 800 sqft", value: 700 },
    { label: "800–1,200 sqft", value: 1000 },
    { label: "1,200–1,800 sqft", value: 1500 },
    { label: "Above 1,800 sqft", value: 2000 },
  ],
};

const areaMultiplier = {
  field: "floorArea",
  tiers: [
    { maxSqft: 800, multiplier: 1.0 },
    { maxSqft: 1200, multiplier: 1.2 },
    { maxSqft: 1800, multiplier: 1.4 },
    { maxSqft: 99999, multiplier: 1.6 },
  ],
};

const bedroomField = {
  key: "bedrooms",
  label: "Number of Bedrooms",
  type: "number" as const,
  min: 1,
  max: 5,
  defaultValue: 2,
};

const bathroomField = {
  key: "bathrooms",
  label: "Number of Bathrooms",
  type: "number" as const,
  min: 1,
  max: 5,
  defaultValue: 1,
};

// ─── Job type data ───

const jobTypes = [
  // ===================== CLEANING (4 types) =====================

  {
    category: "CLEANING" as ServiceCategory,
    name: "Regular Maintenance",
    slug: "regular-maintenance",
    description: "Weekly or bi-weekly home cleaning with standard surface care",
    basePriceCents: 6800,
    unitLabel: "flat rate",
    pricingRules: {
      type: "flat",
      areaMultiplier,
    },
    requiredFields: [floorAreaField],
    addOns: [
      { key: "pet_hair", label: "Pet Hair Removal", priceCents: 800, pricingType: "flat" },
      { key: "fridge", label: "Inside Fridge", priceCents: 1000, pricingType: "flat" },
      { key: "oven", label: "Inside Oven", priceCents: 1500, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "CLEANING" as ServiceCategory,
    name: "Deep Cleaning",
    slug: "deep-cleaning",
    description: "Thorough top-to-bottom cleaning including hidden areas",
    basePriceCents: 12000,
    unitLabel: "flat rate",
    pricingRules: {
      type: "flat",
      areaMultiplier,
    },
    requiredFields: [bedroomField, bathroomField, floorAreaField],
    addOns: [
      { key: "pet_hair", label: "Pet Hair Removal", priceCents: 1000, pricingType: "flat" },
      { key: "fridge", label: "Inside Fridge", priceCents: 1200, pricingType: "flat" },
      { key: "oven", label: "Inside Oven", priceCents: 1800, pricingType: "flat" },
      { key: "window_ext", label: "Window Exterior", priceCents: 2000, pricingType: "flat" },
    ],
    sortOrder: 1,
  },

  {
    category: "CLEANING" as ServiceCategory,
    name: "Move-in / Move-out",
    slug: "move-in-move-out",
    description: "Comprehensive cleaning for property handover",
    basePriceCents: 18000,
    unitLabel: "flat rate",
    pricingRules: {
      type: "flat",
      areaMultiplier,
    },
    requiredFields: [
      bedroomField,
      bathroomField,
      floorAreaField,
      {
        key: "furnishing",
        label: "Furnishing Level",
        type: "select" as const,
        options: [
          { label: "Unfurnished", value: 1 },
          { label: "Partially Furnished", value: 1.3 },
          { label: "Fully Furnished", value: 1.6 },
        ],
      },
    ],
    addOns: [
      { key: "window_ext", label: "Window Exterior", priceCents: 2500, pricingType: "flat" },
      { key: "cabinet_int", label: "Cabinet Interior", priceCents: 2000, pricingType: "flat" },
      { key: "appliance", label: "Appliance Cleaning", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 2,
  },

  {
    category: "CLEANING" as ServiceCategory,
    name: "Post-Renovation",
    slug: "post-renovation",
    description: "Heavy-duty cleaning after renovation works with dust removal",
    basePriceCents: 22000,
    unitLabel: "flat rate",
    pricingRules: {
      type: "flat",
      areaMultiplier,
    },
    requiredFields: [
      floorAreaField,
      {
        key: "rooms",
        label: "Number of Rooms",
        type: "number" as const,
        min: 1,
        max: 8,
        defaultValue: 3,
      },
    ],
    addOns: [
      { key: "chemical_wash", label: "Chemical Wash", priceCents: 4000, pricingType: "flat" },
      { key: "window_clean", label: "Window Cleaning", priceCents: 2500, pricingType: "flat" },
      { key: "high_dusting", label: "High Dusting", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 3,
  },

  // ===================== LAUNDRY (3 types) =====================

  {
    category: "LAUNDRY" as ServiceCategory,
    name: "Wash & Fold",
    slug: "wash-and-fold",
    description: "Professional wash, dry, and fold service",
    basePriceCents: 4500,
    unitLabel: "per load",
    pricingRules: {
      type: "flat",
      multiplierField: "loadSize",
    },
    requiredFields: [
      {
        key: "loadSize",
        label: "Load Size",
        type: "select" as const,
        options: [
          { label: "Small (up to 3kg)", value: 1 },
          { label: "Medium (3–6kg)", value: 1.5 },
          { label: "Large (6–10kg)", value: 2 },
          { label: "Extra Large (10–15kg)", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "ironing", label: "Ironing", priceCents: 1500, pricingType: "flat" },
      { key: "express", label: "Express Same-Day", priceCents: 1000, pricingType: "flat" },
      { key: "delicate", label: "Delicate Care", priceCents: 800, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "LAUNDRY" as ServiceCategory,
    name: "Ironing Only",
    slug: "ironing-only",
    description: "Professional ironing service for your garments",
    basePriceCents: 3000,
    unitLabel: "flat rate",
    pricingRules: {
      type: "flat",
    },
    requiredFields: [
      {
        key: "itemCount",
        label: "Number of Items",
        type: "number" as const,
        min: 1,
        max: 30,
        defaultValue: 5,
      },
    ],
    addOns: [
      { key: "express", label: "Express Same-Day", priceCents: 800, pricingType: "flat" },
    ],
    sortOrder: 1,
  },

  {
    category: "LAUNDRY" as ServiceCategory,
    name: "Dry Cleaning",
    slug: "dry-cleaning",
    description: "Professional dry cleaning for delicate and formal garments",
    basePriceCents: 1500,
    unitLabel: "per item",
    pricingRules: {
      type: "per_item",
      unitField: "itemCount",
    },
    requiredFields: [
      {
        key: "itemCount",
        label: "Number of Items",
        type: "number" as const,
        min: 1,
        max: 10,
        defaultValue: 1,
      },
    ],
    addOns: [
      {
        key: "express",
        label: "Express Service",
        priceCents: 500,
        pricingType: "per_item",
        unitField: "itemCount",
      },
    ],
    sortOrder: 2,
  },

  // ===================== AIRCON (3 types) =====================

  {
    category: "AIRCON" as ServiceCategory,
    name: "Standard Service",
    slug: "aircon-standard",
    description: "Regular aircon servicing with filter cleaning and gas top-up",
    basePriceCents: 4000,
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "unitCount",
    },
    requiredFields: [
      {
        key: "unitCount",
        label: "Number of Units",
        type: "number" as const,
        min: 1,
        max: 10,
        defaultValue: 1,
      },
    ],
    addOns: [
      {
        key: "filter_replace",
        label: "Filter Replacement",
        priceCents: 1500,
        pricingType: "per_unit",
        unitField: "unitCount",
      },
      {
        key: "condenser_clean",
        label: "Condenser Cleaning",
        priceCents: 2500,
        pricingType: "flat",
      },
    ],
    sortOrder: 0,
  },

  {
    category: "AIRCON" as ServiceCategory,
    name: "Chemical Wash",
    slug: "aircon-chemical-wash",
    description: "Deep chemical cleaning for heavily soiled aircon units",
    basePriceCents: 8000,
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "unitCount",
    },
    requiredFields: [
      {
        key: "unitCount",
        label: "Number of Units",
        type: "number" as const,
        min: 1,
        max: 10,
        defaultValue: 1,
      },
    ],
    addOns: [
      {
        key: "filter_replace",
        label: "Filter Replacement",
        priceCents: 1500,
        pricingType: "per_unit",
        unitField: "unitCount",
      },
      {
        key: "antibacterial",
        label: "Anti-Bacterial Wash",
        priceCents: 2000,
        pricingType: "per_unit",
        unitField: "unitCount",
      },
    ],
    sortOrder: 1,
  },

  {
    category: "AIRCON" as ServiceCategory,
    name: "Installation",
    slug: "aircon-installation",
    description: "New aircon unit installation with professional mounting",
    basePriceCents: 15000,
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "unitCount",
    },
    requiredFields: [
      {
        key: "unitCount",
        label: "Number of Units",
        type: "number" as const,
        min: 1,
        max: 5,
        defaultValue: 1,
      },
      {
        key: "mountType",
        label: "Mount Type",
        type: "select" as const,
        options: [
          { label: "Wall Mount", value: 1 },
          { label: "Window Unit", value: 1.1 },
          { label: "Cassette (Ceiling)", value: 1.5 },
        ],
      },
    ],
    addOns: [
      { key: "piping", label: "Piping Work", priceCents: 8000, pricingType: "flat" },
      { key: "bracket", label: "Bracket Installation", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 2,
  },

  // ===================== HANDYMAN (4 types) =====================

  {
    category: "HANDYMAN" as ServiceCategory,
    name: "General Repair",
    slug: "general-repair",
    description: "Fix doors, furniture, fixtures, and general household repairs",
    basePriceCents: 5000,
    unitLabel: "flat rate",
    pricingRules: {
      type: "flat",
      multiplierField: "complexity",
    },
    requiredFields: [
      {
        key: "complexity",
        label: "Complexity",
        type: "select" as const,
        options: [
          { label: "Simple (quick fix)", value: 1 },
          { label: "Moderate (requires tools)", value: 1.5 },
          { label: "Complex (specialised work)", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "parts", label: "Parts (estimated)", priceCents: 2000, pricingType: "flat" },
      { key: "urgent", label: "Urgent Visit", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "HANDYMAN" as ServiceCategory,
    name: "Plumbing",
    slug: "plumbing",
    description: "Leak repairs, unblocking, and pipe installation services",
    basePriceCents: 8000,
    unitLabel: "flat rate",
    pricingRules: {
      type: "flat",
    },
    requiredFields: [
      {
        key: "issueType",
        label: "Issue Type",
        type: "select" as const,
        options: [
          { label: "Leak Repair", value: 1 },
          { label: "Blockage Clearing", value: 1.2 },
          { label: "New Installation", value: 1.5 },
        ],
      },
    ],
    addOns: [
      { key: "parts", label: "Parts (estimated)", priceCents: 2500, pricingType: "flat" },
      { key: "after_hours", label: "After-Hours Service", priceCents: 4000, pricingType: "flat" },
    ],
    sortOrder: 1,
  },

  {
    category: "HANDYMAN" as ServiceCategory,
    name: "Electrical",
    slug: "electrical",
    description: "Wiring, switch, and power point installation and repair",
    basePriceCents: 8000,
    unitLabel: "flat rate",
    pricingRules: {
      type: "flat",
    },
    requiredFields: [
      {
        key: "pointsCount",
        label: "Number of Points",
        type: "number" as const,
        min: 1,
        max: 10,
        defaultValue: 1,
      },
    ],
    addOns: [
      { key: "parts", label: "Parts (estimated)", priceCents: 3000, pricingType: "flat" },
      { key: "after_hours", label: "After-Hours Service", priceCents: 4000, pricingType: "flat" },
    ],
    sortOrder: 2,
  },

  {
    category: "HANDYMAN" as ServiceCategory,
    name: "Painting",
    slug: "painting",
    description: "Interior wall and ceiling painting for rooms and spaces",
    basePriceCents: 12000,
    unitLabel: "per room",
    pricingRules: {
      type: "per_room",
      unitField: "roomCount",
      multiplierField: "wallCondition",
    },
    requiredFields: [
      {
        key: "roomCount",
        label: "Number of Rooms",
        type: "number" as const,
        min: 1,
        max: 6,
        defaultValue: 1,
      },
      {
        key: "wallCondition",
        label: "Wall Condition",
        type: "select" as const,
        options: [
          { label: "Good (touch-up)", value: 1 },
          { label: "Fair (needs 2 coats)", value: 1.2 },
          { label: "Poor (major prep needed)", value: 1.5 },
        ],
      },
    ],
    addOns: [
      {
        key: "ceiling",
        label: "Ceiling Painting",
        priceCents: 5000,
        pricingType: "per_room",
        unitField: "roomCount",
      },
      { key: "feature_wall", label: "Feature Wall", priceCents: 8000, pricingType: "flat" },
      {
        key: "paint_supply",
        label: "Paint Supply",
        priceCents: 3000,
        pricingType: "per_room",
        unitField: "roomCount",
      },
    ],
    sortOrder: 3,
  },
];

async function main() {
  console.log("🧹 Clearing existing ServiceJobType records...");

  const deleted = await db.serviceJobType.deleteMany();
  console.log(`   Deleted ${deleted.count} records`);

  console.log("📦 Seeding 14 ServiceJobType records...\n");

  for (const jt of jobTypes) {
    await db.serviceJobType.create({ data: jt });
    const label = `  ✅ ${jt.category} → ${jt.name}`;
    const price =
      jt.pricingRules.type === "flat"
        ? `$${jt.basePriceCents / 100} flat`
        : `$${jt.basePriceCents / 100}/${jt.unitLabel.replace("per ", "")}`;
    console.log(`${label}  (${price})`);
  }

  const count = await db.serviceJobType.count();
  console.log(`\n🎉 Done! ${count} service job types in database.`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());