import { PrismaClient, ServiceCategory } from "@prisma/client";

const db = new PrismaClient();

// ─── Shared field definitions ────────────────────────────────────────────────

/** Reusable floor-area select field (used by CLEANING & POST-RENOVATION) */
const floorAreaField = {
  key: "floorArea",
  label: "Floor Area",
  type: "select" as const,
  options: [
    { label: "Below 800 sqft", value: 1.0 },
    { label: "800 – 1,200 sqft", value: 1.2 },
    { label: "1,200 – 1,800 sqft", value: 1.4 },
    { label: "Above 1,800 sqft", value: 1.6 },
  ],
};

/** Reusable area-based pricing tiers (same breakpoints as floorAreaField) */
const areaMultiplier = {
  field: "floorArea",
  tiers: [
    { maxSqft: 800, multiplier: 1.0 },
    { maxSqft: 1200, multiplier: 1.2 },
    { maxSqft: 1800, multiplier: 1.4 },
    { maxSqft: 99999, multiplier: 1.6 },
  ],
};

/** Shared aircon unit-count field (1–10, default 1) */
const airconUnitCountField = {
  key: "unitCount",
  label: "Number of Units",
  type: "number" as const,
  min: 1,
  max: 10,
  defaultValue: 1,
};

/** Shared aircon unit-type select (used by Standard / Chemical Wash / Overhaul for surcharges) */
const cassetteTypeField = {
  key: "cassetteType",
  label: "Unit Type",
  type: "select" as const,
  options: [
    { label: "Standard wall unit", value: 0 },
    { label: "Ceiling cassette", value: 1 },
  ],
};

// ─── Job type data ───────────────────────────────────────────────────────────

const jobTypes = [
  // ===================== CLEANING (4 types) =====================

  {
    category: "CLEANING" as ServiceCategory,
    name: "Regular Maintenance",
    slug: "cleaning-regular-maintenance",
    description:
      "Weekly or bi-weekly home cleaning — 3-hour session with standard surface care",
    basePriceCents: 8000, // $80/session
    unitLabel: "per session",
    pricingRules: {
      type: "flat",
      areaMultiplier,
    },
    requiredFields: [floorAreaField],
    addOns: [
      { key: "pet_hair", label: "Pet Hair Removal", priceCents: 800, pricingType: "flat" },
      { key: "fridge_clean", label: "Inside Fridge", priceCents: 1000, pricingType: "flat" },
      { key: "oven_clean", label: "Inside Oven", priceCents: 1500, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "CLEANING" as ServiceCategory,
    name: "Deep Cleaning",
    slug: "cleaning-deep-cleaning",
    description:
      "Thorough top-to-bottom cleaning including hidden corners and fixtures",
    basePriceCents: 30000, // $300/session
    unitLabel: "per session",
    pricingRules: {
      type: "flat",
      areaMultiplier,
    },
    requiredFields: [
      {
        key: "bedrooms",
        label: "Number of Bedrooms",
        type: "number" as const,
        min: 1,
        max: 5,
        defaultValue: 3,
      },
      {
        key: "bathrooms",
        label: "Number of Bathrooms",
        type: "number" as const,
        min: 1,
        max: 4,
        defaultValue: 2,
      },
      floorAreaField,
    ],
    addOns: [
      { key: "window_ext", label: "Window Exterior", priceCents: 2000, pricingType: "flat" },
      { key: "cabinet_int", label: "Cabinet Interior", priceCents: 2000, pricingType: "flat" },
      { key: "appliance_clean", label: "Appliance Cleaning", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 1,
  },

  {
    category: "CLEANING" as ServiceCategory,
    name: "Move-in / Move-out",
    slug: "cleaning-move-in-move-out",
    description: "Comprehensive cleaning for property handover, tenancy start or end",
    basePriceCents: 35000, // $350/session
    unitLabel: "per session",
    pricingRules: {
      type: "flat",
      areaMultiplier,
    },
    requiredFields: [
      {
        key: "bedrooms",
        label: "Number of Bedrooms",
        type: "number" as const,
        min: 1,
        max: 5,
        defaultValue: 3,
      },
      {
        key: "bathrooms",
        label: "Number of Bathrooms",
        type: "number" as const,
        min: 1,
        max: 4,
        defaultValue: 2,
      },
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
    ],
    sortOrder: 2,
  },

  {
    category: "CLEANING" as ServiceCategory,
    name: "Post-Renovation",
    slug: "cleaning-post-renovation",
    description:
      "Heavy-duty cleaning after renovation works with dust and debris removal",
    basePriceCents: 50000, // $500/session
    unitLabel: "per session",
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

  // ===================== LAUNDRY (4 types) =====================

  {
    category: "LAUNDRY" as ServiceCategory,
    name: "Wash & Fold",
    slug: "laundry-wash-and-fold",
    description: "Professional wash, dry, and fold service by load size",
    basePriceCents: 500, // $5 base → multiplied by load size
    unitLabel: "per kg",
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
          { label: "Small (3 kg)", value: 1 },
          { label: "Medium (6 kg)", value: 2 },
          { label: "Large (10 kg)", value: 3.3 },
          { label: "XL (15 kg)", value: 5 },
        ],
      },
    ],
    addOns: [
      { key: "express", label: "Express Same-Day", priceCents: 1000, pricingType: "flat" },
      {
        key: "stain_treatment",
        label: "Stain Treatment",
        priceCents: 500, // $5 × loadSize value
        pricingType: "per_unit",
        unitField: "loadSize",
      },
    ],
    sortOrder: 0,
  },

  {
    category: "LAUNDRY" as ServiceCategory,
    name: "Ironing Only",
    slug: "laundry-ironing-only",
    description: "Professional pressing and ironing for your garments",
    basePriceCents: 300, // $3/piece
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
    slug: "laundry-dry-cleaning",
    description: "Professional dry cleaning for delicate and formal garments",
    basePriceCents: 1000, // $10/item
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
        priceCents: 500, // $5/item
        pricingType: "per_item",
        unitField: "itemCount",
      },
    ],
    sortOrder: 2,
  },

  {
    category: "LAUNDRY" as ServiceCategory,
    name: "Curtain Cleaning",
    slug: "laundry-curtain-cleaning",
    description: "Professional cleaning for all types of curtains and drapes",
    basePriceCents: 1500, // $15/panel
    unitLabel: "per item",
    pricingRules: {
      type: "per_item",
      unitField: "panelCount",
    },
    requiredFields: [
      {
        key: "panelCount",
        label: "Number of Panels",
        type: "number" as const,
        min: 1,
        max: 10,
        defaultValue: 2,
      },
    ],
    addOns: [
      { key: "express", label: "Express Service", priceCents: 2000, pricingType: "flat" },
    ],
    sortOrder: 3,
  },

  // ===================== AIRCON (5 types) =====================

  {
    category: "AIRCON" as ServiceCategory,
    name: "Standard Service",
    slug: "aircon-standard-service",
    description:
      "Regular aircon servicing — filter wash, fan coil vacuum, and general check",
    basePriceCents: 5000, // $50/unit
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "unitCount",
      surcharges: [
        {
          key: "cassetteType",
          label: "Ceiling Cassette",
          amountCents: 8000, // $80/unit
          perUnit: true,
        },
      ],
    },
    requiredFields: [airconUnitCountField, cassetteTypeField],
    addOns: [
      {
        key: "filter_replace",
        label: "Filter Replacement",
        priceCents: 1500, // $15/unit
        pricingType: "per_unit",
        unitField: "unitCount",
      },
      { key: "condenser_clean", label: "Condenser Cleaning", priceCents: 2500, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "AIRCON" as ServiceCategory,
    name: "Chemical Wash",
    slug: "aircon-chemical-wash",
    description:
      "Deep chemical cleaning for heavily soiled aircon units — restores airflow",
    basePriceCents: 9000, // $90/unit
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "unitCount",
      surcharges: [
        {
          key: "cassetteType",
          label: "Ceiling Cassette",
          amountCents: 9000, // $90/unit
          perUnit: true,
        },
      ],
    },
    requiredFields: [airconUnitCountField, cassetteTypeField],
    addOns: [
      {
        key: "antibacterial",
        label: "Anti-Bacterial Wash",
        priceCents: 2000, // $20/unit
        pricingType: "per_unit",
        unitField: "unitCount",
      },
    ],
    sortOrder: 1,
  },

  {
    category: "AIRCON" as ServiceCategory,
    name: "Chemical Overhaul",
    slug: "aircon-chemical-overhaul",
    description:
      "Full chemical overhaul — complete dismantling, deep clean, and reassembly",
    basePriceCents: 15000, // $150/unit
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "unitCount",
      surcharges: [
        {
          key: "cassetteType",
          label: "Ceiling Cassette",
          amountCents: 10000, // $100/unit
          perUnit: true,
        },
      ],
    },
    requiredFields: [
      {
        key: "unitCount",
        label: "Number of Units",
        type: "number" as const,
        min: 1,
        max: 8,
        defaultValue: 1,
      },
      cassetteTypeField,
    ],
    addOns: [
      {
        key: "gas_topup",
        label: "Gas Top-Up",
        priceCents: 4000, // $40/unit
        pricingType: "per_unit",
        unitField: "unitCount",
      },
    ],
    sortOrder: 2,
  },

  {
    category: "AIRCON" as ServiceCategory,
    name: "Installation",
    slug: "aircon-installation",
    description: "New aircon unit installation with professional mounting and testing",
    basePriceCents: 20000, // $200/unit
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "unitCount",
      multiplierField: "mountType",
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
          { label: "Cassette", value: 1.5 },
        ],
      },
    ],
    addOns: [
      { key: "piping", label: "Piping Work", priceCents: 8000, pricingType: "flat" },
      { key: "bracket", label: "Bracket Installation", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 3,
  },

  {
    category: "AIRCON" as ServiceCategory,
    name: "Gas Top-up",
    slug: "aircon-gas-topup",
    description: "Refrigerant gas top-up to restore cooling efficiency",
    basePriceCents: 4000, // $40/unit
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "unitCount",
    },
    requiredFields: [airconUnitCountField],
    addOns: [
      { key: "leak_detection", label: "Leak Detection", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 4,
  },

  // ===================== PLUMBING (4 types) =====================

  {
    category: "PLUMBING" as ServiceCategory,
    name: "Unclogging",
    slug: "plumbing-unclogging",
    description: "Clear blocked drains, toilets, and pipes of all severities",
    basePriceCents: 10000, // $100/job
    unitLabel: "per job",
    pricingRules: {
      type: "flat",
      multiplierField: "severity",
    },
    requiredFields: [
      {
        key: "severity",
        label: "Severity",
        type: "select" as const,
        options: [
          { label: "Minor (slow drain)", value: 1 },
          { label: "Moderate (partial block)", value: 1.5 },
          { label: "Severe (complete block)", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "camera_inspection", label: "Camera Inspection", priceCents: 5000, pricingType: "flat" },
      { key: "after_hours", label: "After-Hours Service", priceCents: 4000, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "PLUMBING" as ServiceCategory,
    name: "Leak Repair",
    slug: "plumbing-leak-repair",
    description: "Locate and repair water leaks in pipes, joints, and fittings",
    basePriceCents: 12000, // $120/job
    unitLabel: "per job",
    pricingRules: {
      type: "flat",
      multiplierField: "location",
    },
    requiredFields: [
      {
        key: "location",
        label: "Leak Location",
        type: "select" as const,
        options: [
          { label: "Exposed Pipe", value: 1 },
          { label: "Concealed (Wall)", value: 2 },
          { label: "Concealed (Ceiling)", value: 2.5 },
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
    category: "PLUMBING" as ServiceCategory,
    name: "Pipe Replacement",
    slug: "plumbing-pipe-replacement",
    description: "Replace old, damaged, or corroded pipes with new ones",
    basePriceCents: 20000, // $200/job
    unitLabel: "per job",
    pricingRules: {
      type: "flat",
      multiplierField: "length",
    },
    requiredFields: [
      {
        key: "length",
        label: "Pipe Length",
        type: "select" as const,
        options: [
          { label: "Short (< 1 m)", value: 1 },
          { label: "Medium (1 – 3 m)", value: 1.5 },
          { label: "Long (> 3 m)", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "new_parts", label: "New Parts", priceCents: 4000, pricingType: "flat" },
      { key: "after_hours", label: "After-Hours Service", priceCents: 4000, pricingType: "flat" },
    ],
    sortOrder: 2,
  },

  {
    category: "PLUMBING" as ServiceCategory,
    name: "Fixture Installation",
    slug: "plumbing-fixture-installation",
    description: "Install or replace taps, shower heads, water heaters, and basins",
    basePriceCents: 15000, // $150/job
    unitLabel: "per job",
    pricingRules: {
      type: "flat",
      multiplierField: "fixtureType",
    },
    requiredFields: [
      {
        key: "fixtureType",
        label: "Fixture Type",
        type: "select" as const,
        options: [
          { label: "Tap / Basin", value: 1 },
          { label: "Shower Head", value: 1.2 },
          { label: "Water Heater", value: 1.5 },
        ],
      },
    ],
    addOns: [
      { key: "supply_lines", label: "Supply Lines", priceCents: 2000, pricingType: "flat" },
      { key: "after_hours", label: "After-Hours Service", priceCents: 4000, pricingType: "flat" },
    ],
    sortOrder: 3,
  },

  // ===================== ELECTRICAL (4 types) =====================

  {
    category: "ELECTRICAL" as ServiceCategory,
    name: "Power Trip Repair",
    slug: "electrical-power-trip-repair",
    description: "Diagnose and fix electrical power trips and circuit issues",
    basePriceCents: 8000, // $80/job
    unitLabel: "per job",
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
          { label: "Simple Reset", value: 1 },
          { label: "Circuit Diagnosis", value: 1.5 },
          { label: "DB Box Issue", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "replacement_parts", label: "Replacement Parts", priceCents: 3000, pricingType: "flat" },
      { key: "after_hours", label: "After-Hours Service", priceCents: 4000, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "ELECTRICAL" as ServiceCategory,
    name: "Power Point Installation",
    slug: "electrical-power-point-installation",
    description: "Install new power points, switches, and outlets",
    basePriceCents: 9000, // $90/point
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "pointCount",
      multiplierField: "pointType",
    },
    requiredFields: [
      {
        key: "pointCount",
        label: "Number of Points",
        type: "number" as const,
        min: 1,
        max: 10,
        defaultValue: 1,
      },
      {
        key: "pointType",
        label: "Point Type",
        type: "select" as const,
        options: [
          { label: "13A Single Socket", value: 1 },
          { label: "13A Double Socket", value: 1.1 },
          { label: "15A Aircon Socket", value: 1.4 },
        ],
      },
    ],
    addOns: [
      {
        key: "concealed_wiring",
        label: "Concealed Wiring",
        priceCents: 5000, // $50/point
        pricingType: "per_unit",
        unitField: "pointCount",
      },
      { key: "after_hours", label: "After-Hours Service", priceCents: 4000, pricingType: "flat" },
    ],
    sortOrder: 1,
  },

  {
    category: "ELECTRICAL" as ServiceCategory,
    name: "Light Fixture Install",
    slug: "electrical-light-fixture-install",
    description: "Install ceiling lights, pendant lamps, and wall-mounted fixtures",
    basePriceCents: 8000, // $80/point
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "pointCount",
      surcharges: [
        {
          key: "newWiring",
          label: "New Wiring Needed",
          amountCents: 4000, // $40/point
          perUnit: true,
        },
      ],
    },
    requiredFields: [
      {
        key: "pointCount",
        label: "Number of Points",
        type: "number" as const,
        min: 1,
        max: 8,
        defaultValue: 1,
      },
      {
        key: "newWiring",
        label: "Wiring Status",
        type: "select" as const,
        options: [
          { label: "Existing wiring", value: 0 },
          { label: "New wiring needed", value: 1 },
        ],
      },
    ],
    addOns: [
      {
        key: "dimmer",
        label: "Dimmer Switch",
        priceCents: 3000, // $30/point
        pricingType: "per_unit",
        unitField: "pointCount",
      },
    ],
    sortOrder: 2,
  },

  {
    category: "ELECTRICAL" as ServiceCategory,
    name: "Ceiling Fan Installation",
    slug: "electrical-ceiling-fan-install",
    description: "Install ceiling fans with secure mounting and electrical connection",
    basePriceCents: 10000, // $100/unit
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "unitCount",
      surcharges: [
        {
          key: "noExistingPoint",
          label: "No Existing Point",
          amountCents: 5000, // $50/unit
          perUnit: true,
        },
      ],
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
        key: "noExistingPoint",
        label: "Existing Wiring Point",
        type: "select" as const,
        options: [
          { label: "Has existing point", value: 0 },
          { label: "No existing point", value: 1 },
        ],
      },
    ],
    addOns: [
      { key: "downrod", label: "Downrod Extension", priceCents: 2000, pricingType: "flat" },
    ],
    sortOrder: 3,
  },

  // ===================== PAINTING (3 types) =====================

  {
    category: "PAINTING" as ServiceCategory,
    name: "Touch-up / Feature Wall",
    slug: "painting-touchup-feature-wall",
    description: "Paint a single accent wall or touch up specific areas",
    basePriceCents: 15000, // $150/wall
    unitLabel: "per room",
    pricingRules: {
      type: "per_room",
      unitField: "wallCount",
      multiplierField: "paintGrade",
    },
    requiredFields: [
      {
        key: "wallCount",
        label: "Number of Walls",
        type: "number" as const,
        min: 1,
        max: 6,
        defaultValue: 1,
      },
      {
        key: "paintGrade",
        label: "Paint Grade",
        type: "select" as const,
        options: [
          { label: "Standard Matt", value: 1 },
          { label: "Washable (Eggshell)", value: 1.3 },
          { label: "Premium (Satin/Gloss)", value: 1.6 },
        ],
      },
    ],
    addOns: [
      {
        key: "ceiling_paint",
        label: "Ceiling Paint",
        priceCents: 5000, // $50/wall
        pricingType: "per_room",
        unitField: "wallCount",
      },
      {
        key: "paint_supply",
        label: "Paint Supply",
        priceCents: 3000, // $30/wall
        pricingType: "per_room",
        unitField: "wallCount",
      },
    ],
    sortOrder: 0,
  },

  {
    category: "PAINTING" as ServiceCategory,
    name: "Room Painting",
    slug: "painting-room-painting",
    description: "Full room painting including walls with professional finish",
    basePriceCents: 32000, // $320/room
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
          { label: "Fair (2 coats)", value: 1.2 },
          { label: "Poor (major prep needed)", value: 1.5 },
        ],
      },
    ],
    addOns: [
      {
        key: "ceiling_paint",
        label: "Ceiling Painting",
        priceCents: 5000, // $50/room
        pricingType: "per_room",
        unitField: "roomCount",
      },
      {
        key: "paint_supply",
        label: "Paint Supply",
        priceCents: 3000, // $30/room
        pricingType: "per_room",
        unitField: "roomCount",
      },
    ],
    sortOrder: 1,
  },

  {
    category: "PAINTING" as ServiceCategory,
    name: "Whole Unit Painting",
    slug: "painting-whole-unit",
    description: "Complete interior painting for the entire flat or apartment",
    basePriceCents: 70000, // $700/flat rate
    unitLabel: "flat rate",
    pricingRules: {
      type: "flat",
      multiplierField: "unitType",
    },
    requiredFields: [
      {
        key: "unitType",
        label: "Unit Type",
        type: "select" as const,
        options: [
          { label: "2-Room HDB", value: 1 },
          { label: "3-Room HDB", value: 1.2 },
          { label: "4-Room HDB", value: 1.5 },
          { label: "3-Bedroom Condo", value: 2 },
          { label: "4-Bedroom Condo", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "ceiling_paint", label: "Ceiling Painting", priceCents: 20000, pricingType: "flat" },
      { key: "sealer_primer", label: "Sealer / Primer", priceCents: 15000, pricingType: "flat" },
      { key: "feature_wall", label: "Feature Wall", priceCents: 8000, pricingType: "flat" },
    ],
    sortOrder: 2,
  },

  // ===================== PEST_CONTROL (4 types) =====================

  {
    category: "PEST_CONTROL" as ServiceCategory,
    name: "Cockroach Control",
    slug: "pest-control-cockroach",
    description: "Professional cockroach extermination with gel bait and residual spray",
    basePriceCents: 12000, // $120/session
    unitLabel: "per session",
    pricingRules: {
      type: "flat",
      multiplierField: "propertyType",
    },
    requiredFields: [
      {
        key: "propertyType",
        label: "Property Type",
        type: "select" as const,
        options: [
          { label: "HDB Flat", value: 1 },
          { label: "Condominium", value: 1.2 },
          { label: "Landed Property", value: 1.8 },
        ],
      },
    ],
    addOns: [
      { key: "followup", label: "Follow-up Visit", priceCents: 8000, pricingType: "flat" },
      { key: "kitchen_deep", label: "Kitchen Deep-Treatment", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "PEST_CONTROL" as ServiceCategory,
    name: "Mosquito Control",
    slug: "pest-control-mosquito",
    description: "Mosquito eradication with fogging and larvicide treatment",
    basePriceCents: 10000, // $100/session
    unitLabel: "per session",
    pricingRules: {
      type: "flat",
      multiplierField: "propertyType",
    },
    requiredFields: [
      {
        key: "propertyType",
        label: "Property Type",
        type: "select" as const,
        options: [
          { label: "HDB Flat", value: 1 },
          { label: "Condominium", value: 1.3 },
          { label: "Landed Property", value: 2 },
        ],
      },
    ],
    addOns: [
      { key: "outdoor_fogging", label: "Outdoor Fogging", priceCents: 5000, pricingType: "flat" },
      { key: "larvicide", label: "Larvicide Treatment", priceCents: 4000, pricingType: "flat" },
    ],
    sortOrder: 1,
  },

  {
    category: "PEST_CONTROL" as ServiceCategory,
    name: "Rodent Control",
    slug: "pest-control-rodent",
    description: "Rat and mouse control with trapping, baiting, and exclusion",
    basePriceCents: 15000, // $150/session
    unitLabel: "per session",
    pricingRules: {
      type: "flat",
      multiplierField: "severity",
    },
    requiredFields: [
      {
        key: "severity",
        label: "Infestation Severity",
        type: "select" as const,
        options: [
          { label: "Mild (occasional sighting)", value: 1 },
          { label: "Moderate (regular activity)", value: 1.5 },
          { label: "Severe (widespread)", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "followup", label: "Follow-up Visit", priceCents: 8000, pricingType: "flat" },
      { key: "bait_station", label: "Bait Station Installation", priceCents: 4000, pricingType: "flat" },
    ],
    sortOrder: 2,
  },

  {
    category: "PEST_CONTROL" as ServiceCategory,
    name: "Termite Control",
    slug: "pest-control-termite",
    description: "Professional termite treatment with drilling and chemical injection",
    basePriceCents: 60000, // $600/session
    unitLabel: "per session",
    pricingRules: {
      type: "flat",
      multiplierField: "treatmentType",
    },
    requiredFields: [
      {
        key: "treatmentType",
        label: "Treatment Type",
        type: "select" as const,
        options: [
          { label: "Spot Treatment", value: 1 },
          { label: "Partial Treatment", value: 1.5 },
          { label: "Full Treatment", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "followup_inspect", label: "Follow-up Inspection", priceCents: 10000, pricingType: "flat" },
      { key: "warranty_ext", label: "Warranty Extension", priceCents: 15000, pricingType: "flat" },
    ],
    sortOrder: 3,
  },

  // ===================== HANDYMAN (4 types) =====================

  {
    category: "HANDYMAN" as ServiceCategory,
    name: "Furniture Assembly",
    slug: "handyman-furniture-assembly",
    description: "Assemble IKEA and flat-pack furniture professionally",
    basePriceCents: 8000, // $80/job
    unitLabel: "per job",
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
          { label: "Simple Shelf / Table", value: 1 },
          { label: "Medium (Wardrobe / Bed Frame)", value: 1.5 },
          { label: "Complex (Full Storage System)", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "wall_anchoring", label: "Wall Anchoring", priceCents: 2000, pricingType: "flat" },
      { key: "disposal", label: "Disposal of Packaging", priceCents: 1500, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "HANDYMAN" as ServiceCategory,
    name: "TV / Shelf Mounting",
    slug: "handyman-tv-shelf-mounting",
    description: "Mount TVs, shelves, and decor securely on walls",
    basePriceCents: 8000, // $80/item
    unitLabel: "per item",
    pricingRules: {
      type: "per_item",
      unitField: "itemCount",
      multiplierField: "wallType",
    },
    requiredFields: [
      {
        key: "itemCount",
        label: "Number of Items",
        type: "number" as const,
        min: 1,
        max: 5,
        defaultValue: 1,
      },
      {
        key: "wallType",
        label: "Wall Type",
        type: "select" as const,
        options: [
          { label: "Concrete Wall", value: 1 },
          { label: "Hollow / Plasterboard Wall", value: 1.3 },
        ],
      },
    ],
    addOns: [
      { key: "cable_conceal", label: "Cable Concealment", priceCents: 3000, pricingType: "flat" },
      { key: "xl_tv", label: "Extra-Large TV (>65\")", priceCents: 2000, pricingType: "flat" },
    ],
    sortOrder: 1,
  },

  {
    category: "HANDYMAN" as ServiceCategory,
    name: "Door Repair",
    slug: "handyman-door-repair",
    description: "Fix hinges, locks, alignment, and general door issues",
    basePriceCents: 10000, // $100/job
    unitLabel: "per job",
    pricingRules: {
      type: "flat",
      multiplierField: "issueType",
    },
    requiredFields: [
      {
        key: "issueType",
        label: "Issue Type",
        type: "select" as const,
        options: [
          { label: "Hinge Adjustment", value: 1 },
          { label: "Lock Replacement", value: 1.2 },
          { label: "Full Door Repair", value: 2 },
        ],
      },
    ],
    addOns: [
      { key: "new_lock", label: "New Lock Set", priceCents: 4000, pricingType: "flat" },
      { key: "after_hours", label: "After-Hours Service", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 2,
  },

  {
    category: "HANDYMAN" as ServiceCategory,
    name: "General Repair",
    slug: "handyman-general-repair",
    description: "Quick fixes, minor installations, and general household repairs (1 hr)",
    basePriceCents: 8000, // $80/job (1 hr)
    unitLabel: "per job",
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
          { label: "Moderate (needs tools)", value: 1.5 },
          { label: "Complex (specialised work)", value: 2.5 },
        ],
      },
    ],
    addOns: [
      { key: "parts", label: "Parts (estimated)", priceCents: 2000, pricingType: "flat" },
      { key: "urgent", label: "Urgent Visit", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 3,
  },

  // ===================== LOCKSMITH (3 types) =====================

  {
    category: "LOCKSMITH" as ServiceCategory,
    name: "Emergency Unlock",
    slug: "locksmith-emergency-unlock",
    description: "Emergency door unlocking when you're locked out of your home",
    basePriceCents: 8000, // $80/job
    unitLabel: "per job",
    pricingRules: {
      type: "flat",
      multiplierField: "doorType",
      surcharges: [
        {
          key: "afterHours",
          label: "After 6PM / Weekend",
          amountCents: 4000, // $40 flat
          perUnit: false,
        },
      ],
    },
    requiredFields: [
      {
        key: "doorType",
        label: "Door Type",
        type: "select" as const,
        options: [
          { label: "HDB Main Door", value: 1 },
          { label: "Condo Gate", value: 1.3 },
          { label: "Digital Lock", value: 1.5 },
        ],
      },
      {
        key: "afterHours",
        label: "Service Time",
        type: "select" as const,
        options: [
          { label: "Standard hours", value: 0 },
          { label: "After 6PM / Weekend", value: 1 },
        ],
      },
    ],
    addOns: [
      { key: "lock_replace", label: "Lock Replacement", priceCents: 5000, pricingType: "flat" },
    ],
    sortOrder: 0,
  },

  {
    category: "LOCKSMITH" as ServiceCategory,
    name: "Lock Change",
    slug: "locksmith-lock-change",
    description: "Replace existing locks with new mortise, digital, or gate locks",
    basePriceCents: 10000, // $100/lock
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "lockCount",
      multiplierField: "lockType",
    },
    requiredFields: [
      {
        key: "lockCount",
        label: "Number of Locks",
        type: "number" as const,
        min: 1,
        max: 5,
        defaultValue: 1,
      },
      {
        key: "lockType",
        label: "Lock Type",
        type: "select" as const,
        options: [
          { label: "Mortise Lock", value: 1 },
          { label: "Digital Lock", value: 2 },
          { label: "Gate Lock", value: 0.8 },
        ],
      },
    ],
    addOns: [
      {
        key: "extra_keys",
        label: "Additional Keys",
        priceCents: 1500, // $15/key
        pricingType: "per_item",
        unitField: "lockCount",
      },
      { key: "disposal", label: "Disposal", priceCents: 1000, pricingType: "flat" },
    ],
    sortOrder: 1,
  },

  {
    category: "LOCKSMITH" as ServiceCategory,
    name: "Digital Lock Install",
    slug: "locksmith-digital-lock-install",
    description: "Professional installation of smart and digital door locks",
    basePriceCents: 20000, // $200/lock
    unitLabel: "per unit",
    pricingRules: {
      type: "per_unit",
      unitField: "lockCount",
      multiplierField: "brand",
    },
    requiredFields: [
      {
        key: "lockCount",
        label: "Number of Locks",
        type: "number" as const,
        min: 1,
        max: 3,
        defaultValue: 1,
      },
      {
        key: "brand",
        label: "Lock Brand / Tier",
        type: "select" as const,
        options: [
          { label: "Standard", value: 1 },
          { label: "Samsung / Yale", value: 1.3 },
          { label: "Premium (Aqara / Schlage)", value: 1.6 },
        ],
      },
    ],
    addOns: [
      { key: "retrofit", label: "Retrofit Existing Door", priceCents: 5000, pricingType: "flat" },
      { key: "wifi_module", label: "WiFi Module", priceCents: 8000, pricingType: "flat" },
    ],
    sortOrder: 2,
  },

  // ===================== APPLIANCE_REPAIR (3 types) =====================

  {
    category: "APPLIANCE_REPAIR" as ServiceCategory,
    name: "Diagnosis Visit",
    slug: "appliance-repair-diagnosis",
    description:
      "On-site diagnosis visit to identify appliance faults (waived if repair proceeds)",
    basePriceCents: 6000, // $60/visit
    unitLabel: "per job",
    pricingRules: {
      type: "flat",
      multiplierField: "applianceType",
    },
    requiredFields: [
      {
        key: "applianceType",
        label: "Appliance Type",
        type: "select" as const,
        options: [
          { label: "Washing Machine", value: 1 },
          { label: "Refrigerator", value: 1 },
          { label: "Dryer", value: 1 },
          { label: "Oven / Stove", value: 1.2 },
        ],
      },
    ],
    addOns: [] as { key: string; label: string; priceCents: number; pricingType: string; unitField?: string }[],
    sortOrder: 0,
  },

  {
    category: "APPLIANCE_REPAIR" as ServiceCategory,
    name: "Washing Machine Repair",
    slug: "appliance-repair-washing-machine",
    description: "Repair washing machine faults — drum, motor, control board, and more",
    basePriceCents: 12000, // $120/job
    unitLabel: "per job",
    pricingRules: {
      type: "flat",
      multiplierField: "issueType",
    },
    requiredFields: [
      {
        key: "issueType",
        label: "Issue Type",
        type: "select" as const,
        options: [
          { label: "Drum Issue", value: 1 },
          { label: "Motor Problem", value: 1.5 },
          { label: "Control Board", value: 2 },
        ],
      },
    ],
    addOns: [
      { key: "parts", label: "Replacement Parts", priceCents: 4000, pricingType: "flat" },
      { key: "same_day", label: "Same-Day Repair", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 1,
  },

  {
    category: "APPLIANCE_REPAIR" as ServiceCategory,
    name: "Fridge Repair",
    slug: "appliance-repair-fridge",
    description: "Repair refrigerator faults — thermostat, compressor, gas leak, and more",
    basePriceCents: 15000, // $150/job
    unitLabel: "per job",
    pricingRules: {
      type: "flat",
      multiplierField: "issueType",
    },
    requiredFields: [
      {
        key: "issueType",
        label: "Issue Type",
        type: "select" as const,
        options: [
          { label: "Thermostat", value: 1 },
          { label: "Compressor", value: 1.8 },
          { label: "Gas Leak", value: 1.5 },
        ],
      },
    ],
    addOns: [
      { key: "parts", label: "Replacement Parts", priceCents: 5000, pricingType: "flat" },
      { key: "same_day", label: "Same-Day Repair", priceCents: 3000, pricingType: "flat" },
    ],
    sortOrder: 2,
  },
];

// ─── Seed execution ──────────────────────────────────────────────────────────

async function _main() {
  console.log("🧹 Clearing existing ServiceJobType records...");
  try {
    const deleted = await db.serviceJobType.deleteMany();
    console.log(`   Deleted ${deleted.count} records`);
  } catch {
    console.log("   ⚠️  Could not delete (tasks reference job types) — skipping cleanup");
  }

  console.log("📦 Seeding ServiceJobType records...\n");

  for (const jt of jobTypes) {
    await db.serviceJobType.upsert({
      where: { slug: jt.slug },
      update: jt,
      create: jt,
    });
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

export async function main() {
  await _main();
}

// Run directly when executed as a script
if (typeof require !== 'undefined' && require.main === module) {
  _main()
    .catch((e) => {
      console.error("❌ Seed failed:", e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}