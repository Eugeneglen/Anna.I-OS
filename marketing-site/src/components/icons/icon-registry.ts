/**
 * Anna.I Marketing — Icon Registry
 * ─────────────────────────────────────────────────────────────
 * Professional monoline icons built on the Lucide icon library
 * (https://lucide.dev, ISC license). Uniform 2px stroke, round
 * caps & joins, pure outline, geometric-organic balance.
 *
 * Each icon is chosen/composed to directly represent its copy.
 */

export type IconName =
  | 'brain'
  | 'knotScribbleSpiral'
  | 'knot'
  | 'scribble'
  | 'spiral'
  | 'nodeCluster'
  | 'shieldLock'
  | 'eyeScope'
  | 'handSquiggle'
  | 'fingerprint'
  | 'calendarRefresh'
  | 'radarBurst'
  | 'arrowRight'
  | 'check'
  | 'logoMark';

interface IconDef {
  viewBox: string;
  title: string;
  inner: string;
}

export const ICONS: Record<IconName, IconDef> = {

  // ── 1. BRAIN ──────────────────────────────────────────────
  // Copy: "Anna.I remembers your preferences" / "Tell Anna.I what
  // your household needs."  Lucide "brain" + memory spark accent.
  brain: {
    viewBox: '0 0 48 48',
    title: 'Memory and learning',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="M12 18V5"/>
        <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/>
        <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/>
        <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/>
        <path d="M18 18a4 4 0 0 0 2-7.464"/>
        <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/>
        <path d="M6 18a4 4 0 0 1-2-7.464"/>
        <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>
      </g>
      <g class="icon-stroke" stroke-width="1.5">
        <path d="M40 6 L44 6 M42 4 L42 8"/>
      </g>
      <circle class="icon-node" cx="42" cy="6" r="0.5"/>`,
  },

  // ── 2. KNOT → ARROW → SPIRAL ──────────────────────────────
  // Copy: "Chaos → Order" — tangled knot (chaos) → arrow →
  // neat loader spiral (order). Three-part transformation.
  knotScribbleSpiral: {
    viewBox: '0 0 120 48',
    title: 'From chaos to order',
    inner: `
      <g class="icon-stroke" transform="translate(2,8) scale(1.33)" stroke-width="1.7">
        <circle cx="16" cy="8" r="3"/>
        <circle cx="8" cy="24" r="3"/>
        <path d="M8 21V11a4 4 0 0 0 4-4"/>
        <path d="M16 11v4a4 4 0 0 0 4 4h4"/>
        <path d="M11 19c2 1 4 1 6-1"/>
        <path d="M14 14c1 2 3 3 5 3"/>
      </g>
      <g class="icon-stroke" transform="translate(48,0)" stroke-width="2.25">
        <path d="M0 24 L24 24"/>
        <path d="M17 17 L24 24 L17 31"/>
      </g>
      <g class="icon-stroke" transform="translate(78,0)" stroke-width="2.25">
        <path d="M24 6v4"/>
        <path d="M20.2 12.2l-2.9-2.9"/>
        <path d="M18 24h4"/>
        <path d="M20.2 20.2l-2.9 2.9"/>
        <path d="M24 18v4"/>
        <path d="M31.1 13.9l-2.9 2.9"/>
        <path d="M34 24h-4"/>
        <path d="M31.1 13.9l2.9-2.9"/>
      </g>
      <circle class="icon-node" cx="102" cy="24" r="2.5"/>`,
  },

  // ── 3. KNOT ───────────────────────────────────────────────
  // Copy: "Before / You manage" — tangled complexity.
  knot: {
    viewBox: '0 0 48 48',
    title: 'Tangled complexity',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <circle cx="18" cy="18" r="3"/>
        <circle cx="6" cy="6" r="3"/>
        <path d="M6 21V9a9 9 0 0 0 9 9"/>
        <path d="M15 15c-2-2-5-2-7 0"/>
        <path d="M18 11c0-2-2-4-4-4"/>
      </g>`,
  },

  // ── 4. SCRIBBLE ───────────────────────────────────────────
  // Copy: "juggling six apps / mental load" — shuffle crossing.
  scribble: {
    viewBox: '0 0 48 48',
    title: 'Chaotic juggling',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="m18 14 4 4-4 4"/>
        <path d="m18 2 4 4-4 4"/>
        <path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/>
        <path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/>
        <path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>
      </g>`,
  },

  // ── 5. SPIRAL ─────────────────────────────────────────────
  // Copy: "With Anna.I / You approve" — coordinated order.
  spiral: {
    viewBox: '0 0 48 48',
    title: 'Coordinated order',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="M12 2v4"/>
        <path d="m16.2 7.8 2.9-2.9"/>
        <path d="M18 12h4"/>
        <path d="m16.2 16.2 2.9 2.9"/>
        <path d="M12 18v4"/>
        <path d="m4.9 19.1 2.9-2.9"/>
        <path d="M2 12h4"/>
        <path d="m4.9 4.9 2.9 2.9"/>
      </g>
      <circle class="icon-node" cx="24" cy="24" r="2"/>`,
  },

  // ── 6. NODE CLUSTER ───────────────────────────────────────
  // Copy: "Cleaning" / "matches you with a vetted vendor."
  // Lucide "share-2" — hub-and-spoke coordination network.
  nodeCluster: {
    viewBox: '0 0 48 48',
    title: 'Coordinated network',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.5">
        <line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/>
        <line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>
      </g>
      <g class="icon-node">
        <circle cx="36" cy="10" r="5"/>
        <circle cx="12" cy="24" r="5"/>
        <circle cx="36" cy="38" r="5"/>
      </g>`,
  },

  // ── 7. SHIELD + CHECK ─────────────────────────────────────
  // Copy: "Milestone escrow" — Lucide "shield-check".
  shieldLock: {
    viewBox: '0 0 48 48',
    title: 'Secured and protected',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
        <path d="m9 12 2 2 4-4"/>
      </g>`,
  },

  // ── 8. EYE + SCAN ─────────────────────────────────────────
  // Copy: "Photo-verified completion" — Lucide "scan-eye".
  eyeScope: {
    viewBox: '0 0 48 48',
    title: 'Verified oversight',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
        <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
        <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
        <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
        <path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"/>
      </g>
      <circle class="icon-node" cx="24" cy="24" r="2.5"/>`,
  },

  // ── 9. HAND ───────────────────────────────────────────────
  // Copy: "juggling six apps" — Lucide "hand".
  handSquiggle: {
    viewBox: '0 0 48 48',
    title: 'Manual effort and juggling',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/>
        <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/>
        <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/>
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
      </g>`,
  },

  // ── 10. FINGERPRINT ───────────────────────────────────────
  // Copy: "Verified vendor network" — Lucide "fingerprint".
  fingerprint: {
    viewBox: '0 0 48 48',
    title: 'Identity verification',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
        <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
        <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
        <path d="M2 12a10 10 0 0 1 18-6"/>
        <path d="M2 16h.01"/>
        <path d="M21.8 16c.2-2 .131-5.354 0-6"/>
        <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>
        <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
        <path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>
      </g>`,
  },

  // ── 11. CALENDAR + CHECK ──────────────────────────────────
  // Copy: "Laundry / remembers for next time" — Lucide "calendar-check".
  calendarRefresh: {
    viewBox: '0 0 48 48',
    title: 'Recurring scheduling',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="M8 2v4"/>
        <path d="M16 2v4"/>
        <rect width="18" height="18" x="3" y="4" rx="2"/>
        <path d="M3 10h18"/>
        <path d="m9 16 2 2 4-4"/>
      </g>`,
  },

  // ── 12. RADAR ─────────────────────────────────────────────
  // Copy: "Aircon Servicing / smart dispatch" — Lucide "radar".
  radarBurst: {
    viewBox: '0 0 48 48',
    title: 'Smart routing and dispatch',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/>
        <path d="M4 6h.01"/>
        <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/>
        <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/>
        <path d="M12 18h.01"/>
        <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/>
        <path d="m13.41 10.59 5.66-5.66"/>
      </g>
      <circle class="icon-node" cx="24" cy="24" r="3"/>`,
  },

  // ── 13. ARROW RIGHT ───────────────────────────────────────
  arrowRight: {
    viewBox: '0 0 48 48',
    title: 'Arrow right',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.125">
        <path d="M5 12h14"/>
        <path d="m12 5 7 7-7 7"/>
      </g>`,
  },

  // ── 14. CHECK ─────────────────────────────────────────────
  check: {
    viewBox: '0 0 48 48',
    title: 'Check',
    inner: `
      <g class="icon-stroke" transform="scale(2)" stroke-width="1.25">
        <path d="M20 6 9 17l-5-5"/>
      </g>`,
  },

  // ── 15. ANNA.I LOGO MARK ──────────────────────────────────
  logoMark: {
    viewBox: '0 0 48 48',
    title: 'Anna.I',
    inner: `
      <g class="icon-stroke" stroke-width="2.5">
        <path d="M9 40 L24 9 L39 40"/>
        <path d="M16 30 L32 30"/>
      </g>
      <circle class="icon-node" cx="24" cy="9" r="3.5"/>`,
  },
};
