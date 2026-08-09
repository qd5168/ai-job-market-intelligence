import type { SalaryPeriod } from '@ai-job-market-intelligence/shared';
import { mapCountryToRegionBucket } from '@ai-job-market-intelligence/shared/regions';
import type { JobInput, ProfileInput } from '../types';

const SKILL_WEIGHT = 60;
const EXPERIENCE_CLOSE_SCORE = 25;
const EXPERIENCE_NEAR_SCORE = 15;
const EXPERIENCE_FAR_SCORE = 5;
const ROLE_MATCH_SCORE = 15;
const LOCATION_INELIGIBLE_PENALTY = 40;
const SALARY_MISMATCH_PENALTY = 15;
const HOURLY_HOURS_PER_YEAR = 2080;
const MONTHS_PER_YEAR = 12;

interface SeniorityRange {
  pattern: RegExp;
  mid: number;
}

// staff/principal/lead maps to "10+ years", using 15 as the representative midpoint
const SENIORITY_RANGES: SeniorityRange[] = [
  { pattern: /\b(intern|junior)\b/i, mid: 1 },
  { pattern: /\b(senior|sr)\b/i, mid: 7.5 },
  { pattern: /\b(staff|principal|lead)\b/i, mid: 15 },
];
const DEFAULT_SENIORITY_MID = 3.5; // mid-level / no keyword match -> 2-5 years

function inferSeniorityMid(title: string): number {
  const match = SENIORITY_RANGES.find((range) => range.pattern.test(title));
  return match ? match.mid : DEFAULT_SENIORITY_MID;
}

function matchSkillsScore(skills: string[], job: JobInput): number {
  if (skills.length === 0) return 0;
  const jobText = `${job.title} ${job.description} ${job.tags.join(' ')}`.toLowerCase();
  const matched = skills.filter((skill) => jobText.includes(skill.toLowerCase()));
  return (matched.length / skills.length) * SKILL_WEIGHT;
}

function experienceScore(years: number, title: string): number {
  const expectedMid = inferSeniorityMid(title);
  const diff = Math.abs(years - expectedMid);
  if (diff <= 2) return EXPERIENCE_CLOSE_SCORE;
  if (diff <= 4) return EXPERIENCE_NEAR_SCORE;
  return EXPERIENCE_FAR_SCORE;
}

// Tags carry the bare role family (e.g. "Backend-Engineer") without a
// seniority modifier, so a preferred role like "Senior Backend Engineer"
// needs that prefix stripped before it can match — seniority itself is
// already scored separately by experienceScore.
const SENIORITY_PREFIX = /^(intern|junior|jr|mid|senior|sr|staff|principal|lead)\s+/i;

// Job titles that use a leveling scheme instead of a role-family word (e.g.
// "Software Development Engineer III") won't literally contain a preferred
// role like "Backend Engineer" — but source sites already tag postings with
// standardized, hyphenated role labels (e.g. "Backend-Engineer"), so the
// search text includes tags too, normalized to spaces, alongside the title.
function roleScore(preferredRoles: string[], title: string, tags: string[]): number {
  const searchText = `${title} ${tags.join(' ')}`.toLowerCase().replace(/[-_]/g, ' ');
  const firstWord = title.toLowerCase().split(' ')[0] ?? '';
  const matched = preferredRoles.some((role) => {
    const roleLower = role.toLowerCase().replace(SENIORITY_PREFIX, '');
    return searchText.includes(roleLower) || roleLower.includes(firstWord);
  });
  return matched ? ROLE_MATCH_SCORE : 0;
}

export function computeRuleScore(profile: ProfileInput, job: JobInput): number {
  const skillScore = matchSkillsScore(profile.skills, job);
  const expScore = experienceScore(profile.experienceYears, job.title);
  const role = roleScore(profile.preferredRoles, job.title, job.tags);
  const raw =
    skillScore + expScore + role - regionPenalty(profile, job) - salaryPenalty(profile, job);
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// R4 location eligibility: a ranking-only deduction, not a veto —
// currentCountry answers "can I actually do this job", an objective fact
// (e.g. a posting requiring "Remote, from Europe" isn't reachable by a user
// actually based in China), not a subjective preference. A mismatch still
// gets scored normally and shown, just ranked lower — companies
// occasionally make exceptions (visa sponsorship etc.), so a flat penalty is
// enough to sort it down without fully hiding it. Two signals, most precise
// first:
// 1. job.locationCountry — a single country deterministically parsed from
//    the posting's own location text, compared directly against
//    currentCountry with no bucket mapping involved.
// 2. job.eligibleRegions — JD-derived region buckets, used when
//    locationCountry couldn't resolve to exactly one country (e.g. generic
//    "Remote", or multiple countries listed).
export function regionPenalty(profile: ProfileInput, job: JobInput): number {
  if (!profile.currentCountry) return 0; // not filled in, don't check

  if (job.locationCountry) {
    return job.locationCountry === profile.currentCountry ? 0 : LOCATION_INELIGIBLE_PENALTY;
  }

  if (job.eligibleRegions.length === 0) return 0; // no explicit restriction, treated as globally open

  const currentBucket = mapCountryToRegionBucket(profile.currentCountry);
  return job.eligibleRegions.includes(currentBucket) ? 0 : LOCATION_INELIGIBLE_PENALTY;
}

// Exported for reuse by packages/ai/src/career/salary-range.ts — same "no
// currency conversion, period-only normalization" assumption applies there.
export function normalizeToAnnualUSD(amount: number, period: SalaryPeriod | null): number {
  if (period === 'HOURLY') return amount * HOURLY_HOURS_PER_YEAR;
  if (period === 'MONTHLY') return amount * MONTHS_PER_YEAR;
  return amount;
}

// R5 salary preference: a ranking-only deduction, not a
// veto — job salary data is incomplete (only sourceStructured provides it
// natively; everything else is a best-effort LLM extraction), so an unknown
// job salary is treated as "unknown", not "doesn't meet expectations".
export function salaryPenalty(profile: ProfileInput, job: JobInput): number {
  if (!profile.expectedSalaryMin) return 0; // no salary preference, don't check
  if (job.salaryMin == null && job.salaryMax == null) return 0; // job salary undisclosed, don't check

  // Compare against the top of the job's range, giving it the best chance to qualify.
  const jobTop = job.salaryMax ?? job.salaryMin!;
  const normalizedJobTop = normalizeToAnnualUSD(jobTop, job.salaryPeriod);
  return normalizedJobTop < profile.expectedSalaryMin ? SALARY_MISMATCH_PENALTY : 0;
}
