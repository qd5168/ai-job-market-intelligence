// Bumped whenever the scoring algorithm changes in a way that should trigger
// re-scoring of already-scored jobs.
// v3: region/salary preference penalties (R4/R5) + roleScore now matches
// against job tags too, not just title.
// v4: R4 rewritten from a preferredCountries preference check to a
// currentCountry eligibility check (LOCATION_INELIGIBLE_PENALTY = 40).
export const CURRENT_SCORING_VERSION = 'v4';
