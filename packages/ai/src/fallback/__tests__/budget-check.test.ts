import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasFallbackBudget, resetFallbackBudgetCache } from '../budget-check';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function mockCreditsResponse(totalCredits: number | null, totalUsage: number | null, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => ({ data: { total_credits: totalCredits, total_usage: totalUsage } }),
  });
}

beforeEach(() => {
  resetFallbackBudgetCache();
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENROUTER_FALLBACK_MIN_BALANCE_USD;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('hasFallbackBudget', () => {
  it('returns true when remaining balance is at or above the default $1 threshold', async () => {
    global.fetch = mockCreditsResponse(10, 5) as unknown as typeof fetch;

    expect(await hasFallbackBudget()).toBe(true);
  });

  it('returns false when remaining balance is below the threshold', async () => {
    global.fetch = mockCreditsResponse(10, 9.5) as unknown as typeof fetch;

    expect(await hasFallbackBudget()).toBe(false);
  });

  it('respects a custom OPENROUTER_FALLBACK_MIN_BALANCE_USD threshold', async () => {
    process.env.OPENROUTER_FALLBACK_MIN_BALANCE_USD = '10';
    global.fetch = mockCreditsResponse(10, 5) as unknown as typeof fetch;

    expect(await hasFallbackBudget()).toBe(false);
  });

  it('returns false when the account balance has gone negative', async () => {
    global.fetch = mockCreditsResponse(10, 10.23) as unknown as typeof fetch;

    expect(await hasFallbackBudget()).toBe(false);
  });

  it('conservatively returns false when total_credits/total_usage are missing from the response', async () => {
    global.fetch = mockCreditsResponse(null, null) as unknown as typeof fetch;

    expect(await hasFallbackBudget()).toBe(false);
  });

  it('conservatively returns false when the credits request fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    expect(await hasFallbackBudget()).toBe(false);
  });

  it('conservatively returns false on a non-ok response', async () => {
    global.fetch = mockCreditsResponse(100, 0, false) as unknown as typeof fetch;

    expect(await hasFallbackBudget()).toBe(false);
  });

  it('caches the result so a second call within the TTL does not refetch', async () => {
    const fetchMock = mockCreditsResponse(10, 5);
    global.fetch = fetchMock as unknown as typeof fetch;

    await hasFallbackBudget();
    await hasFallbackBudget();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
