import type { RegionBucket, SalaryPeriod } from '@ai-job-market-intelligence/shared';

export interface ProfileInput {
  skills: string[];
  experienceYears: number;
  preferredRoles: string[];
  // ISO 3166-1 alpha-2 — where the user is actually based / has work
  // authorization, not a preference. null = not filled in, don't check
  // eligibility. Mapped to a RegionBucket at scoring time when needed (see
  // rule-score.ts's computeEligibility), not stored as a bucket.
  currentCountry: string | null;
  // Expected minimum annual salary (USD). null = no salary preference.
  expectedSalaryMin: number | null;
}

export interface JobInput {
  title: string;
  company: string;
  tags: string[];
  description: string;
  // Deterministically string-matched from location text — takes priority
  // over eligibleRegions for R4 eligibility when a single country is found
  // (see rule-score.ts's computeEligibility).
  locationCountry: string | null;
  eligibleRegions: RegionBucket[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod | null;
}
