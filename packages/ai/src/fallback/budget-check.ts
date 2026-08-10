const BUDGET_CACHE_TTL_MS = 60_000; // short TTL so a burst of calls doesn't hammer this endpoint per LLM call
const DEFAULT_MIN_BALANCE_USD = 1;

interface CreditsResponse {
  data?: { total_credits?: number | null; total_usage?: number | null };
}

interface CachedBudget {
  value: boolean;
  expiresAt: number;
}

let cache: CachedBudget | undefined;

// Uses OpenRouter's own account ledger (GET /credits: total_credits -
// total_usage = actual remaining balance) instead of tracking spend
// ourselves — cached for BUDGET_CACHE_TTL_MS since this
// is checked before every fallback-eligible call.
//
// Deliberately NOT the /key endpoint's limit_remaining: that field reflects
// an optional per-key spend cap (usually unconfigured, i.e. null) rather
// than the account's real balance, so it can't be used to enforce
// OPENROUTER_FALLBACK_MIN_BALANCE_USD.
export async function hasFallbackBudget(): Promise<boolean> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const minBalance = Number(
    process.env.OPENROUTER_FALLBACK_MIN_BALANCE_USD ?? DEFAULT_MIN_BALANCE_USD,
  );
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://openrouter.ai/api/v1';

  let value: boolean;
  try {
    const res = await fetch(`${baseUrl}/credits`, {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    if (!res.ok) {
      value = false; // can't confirm budget — be conservative and skip the fallback
    } else {
      const body = (await res.json()) as CreditsResponse;
      const totalCredits = body.data?.total_credits;
      const totalUsage = body.data?.total_usage;
      // Missing fields = can't confirm the real balance — be conservative.
      value = totalCredits != null && totalUsage != null && totalCredits - totalUsage >= minBalance;
    }
  } catch {
    value = false;
  }

  cache = { value, expiresAt: Date.now() + BUDGET_CACHE_TTL_MS };
  return value;
}

// Test-only: clears the module-level cache between cases.
export function resetFallbackBudgetCache(): void {
  cache = undefined;
}
