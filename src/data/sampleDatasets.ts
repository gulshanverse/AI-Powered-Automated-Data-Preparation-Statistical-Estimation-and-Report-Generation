import { DataRow } from '../types/statigen';

export interface SampleDatasetMeta {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  sourceNote: string;
  defaultWeightColumn: string;
  defaultStratumColumn: string;
  rows: DataRow[];
}

// Deterministic PRNG (Mulberry32) so sample datasets are reproducible across sessions
function createRng(seed: number) {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(rng: () => number, mean: number, sd: number): number {
  const u1 = Math.max(1e-7, rng());
  const u2 = rng();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * sd;
}

function generateHouseholdSurvey(): DataRow[] {
  const rng = createRng(42071);
  const regions = ['North', 'South', 'East', 'West'];
  const sectors = ['Urban', 'Rural'];
  const educationLevels = ['Secondary', 'Undergraduate', 'Postgraduate', 'Primary'];

  const rows: DataRow[] = [];

  for (let i = 1; i <= 240; i++) {
    const region = regions[Math.floor(rng() * regions.length)];
    const isUrban = rng() < 0.44;
    const sector = isUrban ? 'Urban' : 'Rural';

    // Rural households carry higher sampling weights (lower sampling fraction in rural frame)
    const baseWeight = isUrban ? 120 + rng() * 65 : 265 + rng() * 140;
    const sampling_weight = Math.round(baseWeight * 10) / 10;

    const regionalFactor =
      region === 'West' ? 1.18 : region === 'South' ? 1.12 : region === 'North' ? 1.0 : 0.86;
    const urbanFactor = isUrban ? 1.48 : 0.82;

    let monthly_income: number | null = Math.round(
      Math.max(450, normalSample(rng, 2850 * regionalFactor * urbanFactor, 760 * urbanFactor))
    );
    let monthly_expenditure: number | null = Math.round(
      Math.max(320, monthly_income * (0.62 + rng() * 0.24) + normalSample(rng, 0, 140))
    );
    let healthcare_spend: number | null = Math.round(
      Math.max(25, normalSample(rng, isUrban ? 245 : 150, 75))
    );
    let household_size: number | null = Math.max(
      1,
      Math.min(9, Math.round(normalSample(rng, isUrban ? 3.2 : 4.6, 1.25)))
    );
    let head_age: number | null = Math.max(
      21,
      Math.min(78, Math.round(normalSample(rng, 44, 11.5)))
    );

    const edRoll = rng();
    let education: string | null =
      edRoll < (isUrban ? 0.36 : 0.14)
        ? 'Undergraduate'
        : edRoll < (isUrban ? 0.56 : 0.21)
        ? 'Postgraduate'
        : edRoll < 0.84
        ? 'Secondary'
        : 'Primary';

    // Inject realistic data quality defects for StatiGen AI to detect and clean
    if (i % 19 === 0) monthly_income = null; // ~5% missing income
    if (i % 27 === 0) monthly_expenditure = null; // ~3.7% missing expenditure
    if (i % 23 === 0) healthcare_spend = null; // ~4.3% missing healthcare
    if (i % 41 === 0) education = null; // ~2.4% missing categorical
    if (i % 53 === 0) household_size = null;

    // Inject high-leverage entry outliers (keying errors / extreme values)
    if (i === 14) monthly_income = 24800;
    if (i === 67) monthly_income = 31200;
    if (i === 142) monthly_expenditure = 19400;
    if (i === 188) healthcare_spend = 4850;
    if (i === 209) head_age = 148;

    // Inject two negative coding errors (e.g. -999 sentinel values)
    if (i === 93) healthcare_spend = -120;
    if (i === 171) monthly_expenditure = -450;

    // Inject slight casing inconsistency in sector
    const sectorDisplay = i === 31 ? ' urban ' : i === 115 ? 'RURAL' : sector;

    rows.push({
      household_id: `HH-${String(1000 + i)}`,
      region,
      sector: sectorDisplay,
      education,
      household_size,
      head_age,
      monthly_income,
      monthly_expenditure,
      healthcare_spend,
      sampling_weight,
    });
  }

  // Add 4 exact duplicate rows to demonstrate deduplication
  rows.push({ ...rows[11] });
  rows.push({ ...rows[47] });
  rows.push({ ...rows[104] });
  rows.push({ ...rows[162] });

  return rows;
}

function generateLaborForceSurvey(): DataRow[] {
  const rng = createRng(88123);
  const industries = ['Manufacturing', 'Services', 'Agriculture', 'Technology', 'Construction'];
  const zones = ['Metro Core', 'Suburban Belt', 'Provincial Towns', 'Rural District'];

  const rows: DataRow[] = [];

  for (let i = 1; i <= 190; i++) {
    const zone = zones[Math.floor(rng() * zones.length)];
    const industry = industries[Math.floor(rng() * industries.length)];
    const isMetro = zone === 'Metro Core' || zone === 'Suburban Belt';

    const design_weight =
      Math.round((isMetro ? 85 + rng() * 45 : 190 + rng() * 115) * 10) / 10;

    const indMultiplier =
      industry === 'Technology'
        ? 1.55
        : industry === 'Services'
        ? 1.05
        : industry === 'Manufacturing'
        ? 1.0
        : industry === 'Construction'
        ? 0.92
        : 0.68;

    let weekly_hours: number | null = Math.round(
      Math.max(12, Math.min(72, normalSample(rng, 41.5, 8.2))) * 10
    ) / 10;
    let hourly_wage: number | null =
      Math.round(
        Math.max(7.5, normalSample(rng, 24.5 * indMultiplier * (isMetro ? 1.2 : 0.88), 6.4)) * 100
      ) / 100;
    let tenure_years: number | null =
      Math.round(Math.max(0.2, normalSample(rng, 6.2, 4.1)) * 10) / 10;
    let training_hours_yr: number | null = Math.round(
      Math.max(0, normalSample(rng, industry === 'Technology' ? 38 : 18, 11))
    );
    let employment_status: string | null =
      rng() < 0.72 ? 'Full-Time' : rng() < 0.9 ? 'Part-Time' : 'Contract';

    if (i % 17 === 0) hourly_wage = null;
    if (i % 29 === 0) weekly_hours = null;
    if (i % 34 === 0) training_hours_yr = null;
    if (i % 45 === 0) employment_status = null;

    if (i === 22) hourly_wage = 215.5;
    if (i === 98) hourly_wage = 188.0;
    if (i === 131) weekly_hours = 142;
    if (i === 155) training_hours_yr = -25;

    rows.push({
      worker_id: `LF-${String(2000 + i)}`,
      zone,
      industry,
      employment_status: i === 58 ? ' full-time ' : employment_status,
      weekly_hours,
      hourly_wage,
      tenure_years,
      training_hours_yr,
      design_weight,
    });
  }

  rows.push({ ...rows[15] });
  rows.push({ ...rows[82] });

  return rows;
}

export const SAMPLE_DATASETS: SampleDatasetMeta[] = [
  {
    id: 'household-consumption',
    name: 'National Household Income & Consumption Survey (2025)',
    shortLabel: 'Household Consumption Survey',
    description:
      'Stratified two-stage household survey across four geographic regions and urban/rural strata with unequal sampling weights, missing entries, coding anomalies, and extreme income outliers.',
    sourceNote: 'Synthetic benchmark modeled on national household expenditure surveys (n = 244)',
    defaultWeightColumn: 'sampling_weight',
    defaultStratumColumn: 'sector',
    rows: generateHouseholdSurvey(),
  },
  {
    id: 'labor-force-wages',
    name: 'Quarterly Labor Force & Wage Structure Survey (2025)',
    shortLabel: 'Labor Force & Wage Survey',
    description:
      'Establishment and worker microdata covering weekly hours, hourly earnings, tenure, and workforce training across economic zones and industry classifications with design weights.',
    sourceNote: 'Synthetic benchmark modeled on national labor force microdata (n = 192)',
    defaultWeightColumn: 'design_weight',
    defaultStratumColumn: 'zone',
    rows: generateLaborForceSurvey(),
  },
];
