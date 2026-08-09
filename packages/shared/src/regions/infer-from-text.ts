import type { RegionBucket } from '../schemas/common';
import { mapCountryToRegionBucket } from './country-region-map';
import { COUNTRY_NAME_TO_ALPHA2 } from './countries';

// Deterministic, regex-based fallback for the LLM-parsed path
// (parse-job-fields.ts): the LLM's own eligibleRegions extraction sometimes
// misses an explicit restriction despite the prompt covering it — this runs
// when the LLM returns an empty array. sourceStructured sources (Himalayas)
// don't go through this at all; they use their own native
// locationRestrictions field instead (see mapLocationRestrictionsToRegionBuckets
// in ./location-country.ts).
// Precision over recall by design: every pattern here was built from a real
// posting that stated an explicit restriction, not a guess. A restriction
// that isn't caught just falls back to "no restriction detected" (the
// pre-existing behavior), rather than risk a false positive that
// incorrectly narrows a job's eligible regions.

let countryNameToCode: Map<string, string> | null = null;

function getCountryNameToCode(): Map<string, string> {
  if (countryNameToCode) return countryNameToCode;
  const map = new Map<string, string>();
  for (const [name, code] of COUNTRY_NAME_TO_ALPHA2) {
    map.set(name.toLowerCase(), code);
  }
  // Common short forms real postings use that aren't the official alias.
  map.set('us', 'US');
  map.set('u.s.', 'US');
  map.set('u.s.a.', 'US');
  map.set('usa', 'US');
  map.set('uk', 'GB');
  map.set('u.k.', 'GB');
  countryNameToCode = map;
  return map;
}

const DIRECT_BUCKET_PATTERNS: Array<{ pattern: RegExp; bucket: RegionBucket }> = [
  { pattern: /\b(?:latam|latin america)\b.{0,20}\btime\s*zones?\b/i, bucket: 'LATAM' },
  { pattern: /\bmust be based\b.{0,20}\b(?:latam|latin america)\b/i, bucket: 'LATAM' },
  { pattern: /\bmust be based\b.{0,20}\bapac\b/i, bucket: 'APAC' },
  { pattern: /\bapac\b.{0,20}\btime\s*zones?\b/i, bucket: 'APAC' },
  { pattern: /\b(?:eu|european)\b.{0,20}\btime\s*zone\s+overlap\b/i, bucket: 'EU' },
  { pattern: /\bmust be based\b.{0,20}\b(?:the )?(?:eu|european union)\b/i, bucket: 'EU' },
  { pattern: /\bmust be based\b.{0,20}\b(?:the )?(?:uk|united kingdom)\b/i, bucket: 'UK' },
  { pattern: /\bmust have\b.{0,20}\buk right to work\b/i, bucket: 'UK' },
  { pattern: /\bmust be based\b.{0,20}\b(?:the )?(?:us|u\.s\.?|united states)\b/i, bucket: 'US' },
  { pattern: /\bmust have\b.{0,20}\bus right to work\b/i, bucket: 'US' },
  { pattern: /\bu\.?s\.?\s+citizen(?:ship)?\b/i, bucket: 'US' },
  { pattern: /\bright to work in\b.{0,20}\b(?:the )?(?:us|united states)\b/i, bucket: 'US' },
];

// Trigger phrases that introduce a specific country name (e.g. "must be
// based in Mexico") — the captured name is resolved through
// i18n-iso-countries and mapped to a RegionBucket via the same lookup
// scoring already uses for a user's currentCountry.
const COUNTRY_TRIGGER_PATTERNS = [
  /\bmust be based (?:in|anywhere in)\s+([a-z][a-z .]{2,40}?)(?=[.,;]|\s+and\b|\s+a citizen\b|$)/gi,
  /\bmust be located in\s+([a-z][a-z .]{2,40}?)(?=[.,;]|$)/gi,
];

export function inferEligibleRegionsFromText(text: string): RegionBucket[] {
  const buckets = new Set<RegionBucket>();

  for (const { pattern, bucket } of DIRECT_BUCKET_PATTERNS) {
    if (pattern.test(text)) buckets.add(bucket);
  }

  const nameToCode = getCountryNameToCode();
  for (const pattern of COUNTRY_TRIGGER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[1]?.trim().toLowerCase();
      if (!candidate) continue;
      const code = nameToCode.get(candidate);
      if (code) buckets.add(mapCountryToRegionBucket(code));
    }
  }

  return [...buckets];
}
