import type { RegionBucket } from '../schemas/common';

// Coarse country -> RegionBucket mapping used only to compare a user's
// currentCountry against a job's eligibleRegions (scoring rule R4).
// REMOTE_GLOBAL/OTHER are never mapping targets a country resolves to on
// purpose here — REMOTE_GLOBAL is a job-side "explicitly open worldwide"
// signal, not a place; any country not in the sets below falls back to
// OTHER rather than being left unmapped.

const EU_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);

const APAC_COUNTRIES = new Set([
  'CN',
  'JP',
  'KR',
  'KP',
  'IN',
  'SG',
  'HK',
  'MO',
  'TW',
  'VN',
  'TH',
  'ID',
  'PH',
  'MY',
  'BN',
  'AU',
  'NZ',
  'PK',
  'BD',
  'LK',
  'NP',
  'MM',
  'KH',
  'LA',
  'MN',
  'BT',
  'MV',
  'FJ',
  'PG',
  'TL',
]);

const LATAM_COUNTRIES = new Set([
  'MX',
  'BR',
  'AR',
  'CL',
  'CO',
  'PE',
  'VE',
  'EC',
  'BO',
  'PY',
  'UY',
  'CR',
  'PA',
  'GT',
  'HN',
  'SV',
  'NI',
  'DO',
  'CU',
  'HT',
  'JM',
  'TT',
  'BZ',
  'GY',
  'SR',
  'BS',
  'BB',
]);

export function mapCountryToRegionBucket(alpha2: string): RegionBucket {
  const code = alpha2.toUpperCase();
  if (code === 'US') return 'US';
  if (code === 'GB') return 'UK';
  if (EU_COUNTRIES.has(code)) return 'EU';
  if (APAC_COUNTRIES.has(code)) return 'APAC';
  if (LATAM_COUNTRIES.has(code)) return 'LATAM';
  return 'OTHER';
}
