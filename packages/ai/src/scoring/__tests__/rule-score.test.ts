import { describe, it, expect } from 'vitest';
import { computeRuleScore, regionPenalty, salaryPenalty } from '../rule-score';
import type { JobInput, ProfileInput } from '../../types';

const job: JobInput = {
  title: 'Senior Backend Engineer',
  company: 'Acme',
  tags: ['node', 'typescript'],
  description: 'We need someone strong in Node.js and TypeScript.',
  locationCountry: null,
  eligibleRegions: [],
  salaryMin: null,
  salaryMax: null,
  salaryPeriod: null,
};

const baseProfile: ProfileInput = {
  skills: [],
  experienceYears: 0,
  preferredRoles: [],
  currentCountry: null,
  expectedSalaryMin: null,
};

describe('computeRuleScore', () => {
  it('full skill match + exact seniority match + no role match = 85', () => {
    // skillScore: 2/2 matched * 60 = 60
    // experienceScore: |7.5 - 7.5| = 0 <= 2 -> 25 (senior mid = 7.5)
    // roleScore: 'Nonexistent Role' doesn't match title -> 0
    const profile = {
      ...baseProfile,
      skills: ['Node.js', 'TypeScript'],
      experienceYears: 7.5,
      preferredRoles: ['Nonexistent Role'],
    };
    expect(computeRuleScore(profile, job)).toBe(85);
  });

  it('no skills contributes 0 to skill_score', () => {
    // skillScore: 0 (empty skills array)
    // experienceScore: |7.5 - 7.5| = 0 -> 25
    // roleScore: 0
    const profile = { ...baseProfile, experienceYears: 7.5 };
    expect(computeRuleScore(profile, job)).toBe(25);
  });

  it('senior title + 8 years experience -> experience_score = 25', () => {
    // |8 - 7.5| = 0.5 <= 2 -> 25
    const profile = { ...baseProfile, experienceYears: 8 };
    expect(computeRuleScore(profile, job)).toBe(25);
  });

  it('matching preferred role contributes role_score = 15', () => {
    // experienceYears far from any seniority bucket -> experience_score = 5
    // preferredRoles matches title -> role_score = 15
    const profile = {
      ...baseProfile,
      experienceYears: 100,
      preferredRoles: ['Backend Engineer'],
    };
    expect(computeRuleScore(profile, job)).toBe(20); // 0 (skill) + 5 (exp, far) + 15 (role)
  });

  it('matches a preferred role via job tags when the title uses a leveling scheme instead', () => {
    // Title alone ("Engineer III") wouldn't match "Backend Engineer", but the
    // hyphenated tag "Backend-Engineer" normalizes to "backend engineer" and
    // is found inside "senior backend engineer".
    const profile = {
      ...baseProfile,
      experienceYears: 100,
      preferredRoles: ['Senior Backend Engineer'],
    };
    const leveledJob = {
      ...job,
      title: 'Software Development Engineer III - Agency Experience',
      tags: ['Full-Stack-Developer', 'Backend-Engineer', 'Frontend-Engineer', 'Software-Engineer'],
    };
    expect(computeRuleScore(profile, leveledJob)).toBe(20); // 0 (skill) + 5 (exp, far) + 15 (role)
  });

  it('deducts the location ineligibility penalty from the additive score', () => {
    // Same as the role-match case (20), minus the 40-point location penalty -> 0 (clamped)
    const profile = {
      ...baseProfile,
      experienceYears: 100,
      preferredRoles: ['Backend Engineer'],
      currentCountry: 'US',
    };
    expect(computeRuleScore(profile, { ...job, eligibleRegions: ['EU'] })).toBe(0);
  });

  it('deducts the salary mismatch penalty from the additive score', () => {
    const profile = {
      ...baseProfile,
      experienceYears: 100,
      preferredRoles: ['Backend Engineer'],
      expectedSalaryMin: 150_000,
    };
    // 20 (role+exp) - 15 (salary penalty) = 5
    expect(computeRuleScore(profile, { ...job, salaryMin: 100_000, salaryMax: 120_000 })).toBe(5);
  });
});

describe('regionPenalty', () => {
  it('returns 0 when the user has not filled in currentCountry', () => {
    expect(regionPenalty(baseProfile, { ...job, eligibleRegions: ['EU'] })).toBe(0);
  });

  it('returns 0 when the job has no explicit region restriction', () => {
    // US maps to the US bucket, see country-region-map.ts
    const profile = { ...baseProfile, currentCountry: 'US' };
    expect(regionPenalty(profile, job)).toBe(0);
  });

  it('returns 40 when the mapped bucket and eligible regions have no overlap', () => {
    const profile = { ...baseProfile, currentCountry: 'US' };
    expect(regionPenalty(profile, { ...job, eligibleRegions: ['EU'] })).toBe(40);
  });

  it('returns 0 when the mapped bucket overlaps', () => {
    // DE -> EU bucket
    const profile = { ...baseProfile, currentCountry: 'DE' };
    expect(regionPenalty(profile, { ...job, eligibleRegions: ['EU', 'UK'] })).toBe(0);
  });

  it('prioritizes locationCountry over eligibleRegions when both are present', () => {
    const profile = { ...baseProfile, currentCountry: 'US' };
    // eligibleRegions says EU (would mismatch), but locationCountry is an
    // exact US match — locationCountry wins, no bucket mapping involved.
    expect(regionPenalty(profile, { ...job, locationCountry: 'US', eligibleRegions: ['EU'] })).toBe(
      0,
    );
  });

  it('penalizes an exact locationCountry mismatch even if it would map to an overlapping bucket', () => {
    const profile = { ...baseProfile, currentCountry: 'DE' };
    // DE and FR both map to the EU bucket, but locationCountry is compared
    // as an exact country, not a bucket — FR !== DE.
    expect(regionPenalty(profile, { ...job, locationCountry: 'FR', eligibleRegions: ['EU'] })).toBe(
      40,
    );
  });

  it('falls back to eligibleRegions when locationCountry could not be resolved', () => {
    const profile = { ...baseProfile, currentCountry: 'US' };
    expect(regionPenalty(profile, { ...job, locationCountry: null, eligibleRegions: ['EU'] })).toBe(
      40,
    );
  });
});

describe('salaryPenalty', () => {
  it('returns 0 when the user has no salary preference', () => {
    expect(salaryPenalty(baseProfile, { ...job, salaryMin: 50_000, salaryMax: 60_000 })).toBe(0);
  });

  it('returns 0 when the job has no disclosed salary', () => {
    const profile = { ...baseProfile, expectedSalaryMin: 100_000 };
    expect(salaryPenalty(profile, job)).toBe(0);
  });

  it('returns 15 when the job salary top is below the expected minimum', () => {
    const profile = { ...baseProfile, expectedSalaryMin: 100_000 };
    expect(salaryPenalty(profile, { ...job, salaryMin: 60_000, salaryMax: 80_000 })).toBe(15);
  });

  it('returns 0 when the job salary top meets the expected minimum', () => {
    const profile = { ...baseProfile, expectedSalaryMin: 100_000 };
    expect(salaryPenalty(profile, { ...job, salaryMin: 90_000, salaryMax: 110_000 })).toBe(0);
  });

  it('normalizes HOURLY salary to annual before comparing', () => {
    const profile = { ...baseProfile, expectedSalaryMin: 100_000 };
    // 50/hr * 2080 = 104,000 >= 100,000 -> no penalty
    expect(
      salaryPenalty(profile, { ...job, salaryMin: 50, salaryMax: 50, salaryPeriod: 'HOURLY' }),
    ).toBe(0);
  });

  it('normalizes MONTHLY salary to annual before comparing', () => {
    const profile = { ...baseProfile, expectedSalaryMin: 100_000 };
    // 7000/mo * 12 = 84,000 < 100,000 -> penalty
    expect(
      salaryPenalty(profile, {
        ...job,
        salaryMin: 7_000,
        salaryMax: 7_000,
        salaryPeriod: 'MONTHLY',
      }),
    ).toBe(15);
  });
});
