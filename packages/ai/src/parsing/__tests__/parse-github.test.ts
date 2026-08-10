import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

const { mockListForUser, mockListLanguages, mockGetReadme } = vi.hoisted(() => ({
  mockListForUser: vi.fn(),
  mockListLanguages: vi.fn(),
  mockGetReadme: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      repos: {
        listForUser: mockListForUser,
        listLanguages: mockListLanguages,
        getReadme: mockGetReadme,
      },
    },
  })),
}));

import { fetchGithubProfile } from '../parse-github';

beforeEach(() => {
  mockCreate.mockReset();
  mockListForUser.mockReset();
  mockListLanguages.mockReset();
  mockGetReadme.mockReset();

  mockListForUser.mockResolvedValue({
    data: [{ name: 'my-repo', description: 'A repo', fork: false }],
  });
  mockListLanguages.mockResolvedValue({ data: { TypeScript: 1000 } });
  mockGetReadme.mockResolvedValue({
    data: { content: Buffer.from('readme text').toString('base64') },
  });
});

describe('fetchGithubProfile', () => {
  it('returns language distribution and an LLM-generated summary', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ summary: 'Strong TypeScript background.' }) } },
      ],
    });

    const result = await fetchGithubProfile('someuser');

    expect(result?.languages).toEqual({ TypeScript: 1000 });
    expect(result?.summary).toBe('Strong TypeScript background.');
  });

  it('recovers a JSON object embedded in a chatty LLM response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              "Here's a thorough analysis of this GitHub profile:\n\n" +
              JSON.stringify({ summary: 'Strong TypeScript background.' }),
          },
        },
      ],
    });

    const result = await fetchGithubProfile('someuser');

    expect(result?.summary).toBe('Strong TypeScript background.');
  });

  it('returns a null summary (not an error) when the free model fails and no fallback is configured', async () => {
    mockCreate.mockRejectedValue(new Error('down'));

    const result = await fetchGithubProfile('someuser');

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result?.summary).toBeNull();
    expect(result?.languages).toEqual({ TypeScript: 1000 }); // languages don't depend on the LLM call
  });

  it('uses CHAT_MODEL_FALLBACK once the free model is exhausted, when configured', async () => {
    process.env.CHAT_MODEL_FALLBACK = 'paid-model';
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { total_credits: 10, total_usage: 5 } }),
    }) as unknown as typeof fetch;

    mockCreate
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify({ summary: 'From the fallback model.' }) } },
        ],
      });

    try {
      const result = await fetchGithubProfile('someuser');

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(mockCreate).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ model: 'paid-model' }),
      );
      expect(result?.summary).toBe('From the fallback model.');
    } finally {
      delete process.env.CHAT_MODEL_FALLBACK;
      global.fetch = originalFetch;
    }
  });
});
