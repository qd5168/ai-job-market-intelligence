// Bumped whenever the scoring algorithm changes in a way that should trigger
// re-scoring of already-scored jobs.
// v3: region/salary preference penalties (R4/R5) + roleScore now matches
// against job tags too, not just title.
// v4: R4 rewritten from a preferredCountries preference check to a
// currentCountry eligibility check (LOCATION_INELIGIBLE_PENALTY = 40).
// v4.1: R4 moved out of rule_score entirely into an independent
// `eligibility` tag (ELIGIBLE/RESTRICTED/INELIGIBLE) so a strong
// skill/experience match no longer gets dragged down by a fixed region
// penalty; the fixed embedding<20 && rule<30 skip-LLM shortcut was also
// replaced by a health-aware gate (see embedding-health.ts) after a
// production incident where a systemically low embedding score caused
// 97.8% of scores to skip the LLM call entirely.
export const CURRENT_SCORING_VERSION = 'v4.1';
