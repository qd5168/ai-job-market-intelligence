import type { JobDecision, JobEligibility } from '@ai-job-market-intelligence/shared';

// Region eligibility is checked first and overrides the score-based
// threshold outright: a job the user is confirmed ineligible for isn't
// worth applying to regardless of match quality, so `score` keeps
// reflecting match quality on its own while `decision` stays a clean
// action recommendation. This is the single place that implements the
// threshold + override — every caller must go through it rather than
// re-deriving decision from score locally (see ai-scoring.md §2.2).
export function toDecision(score: number, eligibility: JobEligibility): JobDecision {
  if (eligibility === 'INELIGIBLE') return 'SKIP';
  if (score >= 75) return 'APPLY';
  if (score >= 50) return 'MAYBE';
  return 'SKIP';
}
