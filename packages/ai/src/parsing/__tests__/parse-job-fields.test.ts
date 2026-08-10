import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import { parseJobFields } from '../parse-job-fields';

beforeEach(() => {
  mockCreate.mockReset();
});

describe('parseJobFields', () => {
  it('parses a valid LLM JSON response into ParsedJobFields', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              role: 'Backend Engineer',
              level: 'Senior',
              skills: ['node.js', 'typescript'],
              salaryMin: 120_000,
              salaryMax: 160_000,
              remote: true,
              eligibleRegions: ['US'],
              confidence: 0.9,
            }),
          },
        },
      ],
    });

    const result = await parseJobFields({
      title: 'Senior Backend Engineer',
      description: 'Build our Node.js platform.',
      tags: ['node'],
    });

    expect(result.role).toBe('Backend Engineer');
    expect(result.level).toBe('Senior');
    expect(result.skills).toEqual(['node.js', 'typescript']);
    expect(result.eligibleRegions).toEqual(['US']);
    expect(result.confidence).toBe(0.9);
  });

  it('truncates skills to 30 instead of rejecting the whole response over the count', async () => {
    const skills = Array.from({ length: 40 }, (_, i) => `skill-${i}`);
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              role: 'Backend Engineer',
              level: 'Senior',
              skills,
              salaryMin: null,
              salaryMax: null,
              remote: true,
              eligibleRegions: ['US'],
              confidence: 0.9,
            }),
          },
        },
      ],
    });

    const result = await parseJobFields({
      title: 'Senior Backend Engineer',
      description: 'Build our platform.',
      tags: [],
    });

    expect(result.skills).toHaveLength(30);
    expect(result.skills).toEqual(skills.slice(0, 30));
  });

  it('drops an eligibleRegions value the model invented instead of rejecting the whole response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              role: 'Backend Engineer',
              level: 'Senior',
              skills: ['node.js'],
              salaryMin: null,
              salaryMax: null,
              remote: true,
              eligibleRegions: ['US', 'EST'],
              confidence: 0.9,
            }),
          },
        },
      ],
    });

    const result = await parseJobFields({
      title: 'Senior Backend Engineer',
      description: 'Build our platform.',
      tags: [],
    });

    expect(result.eligibleRegions).toEqual(['US']);
  });

  // The LLM's own eligibleRegions extraction is unreliable even when the
  // rest of the response is well-formed — this deterministic supplement
  // catches an explicit restriction the LLM missed rather than trusting an
  // empty array as "no restriction stated".
  it('fills in eligibleRegions from the description when the LLM returns an empty array but the text states a restriction', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              role: 'Backend Engineer',
              level: 'Senior',
              skills: ['typescript'],
              salaryMin: null,
              salaryMax: null,
              remote: true,
              eligibleRegions: [],
              confidence: 0.9,
            }),
          },
        },
      ],
    });

    const result = await parseJobFields({
      title: 'Senior Backend Engineer',
      description:
        'This is a full-time remote position for specialists located in LATAM time zones close to the US.',
      tags: [],
    });

    expect(result.eligibleRegions).toEqual(['LATAM']);
    expect(result.confidence).toBe(0.9); // supplement only touches eligibleRegions
  });

  // google/gemma-4-26b-a4b-it:free returns remote: null (instead of
  // true/false) when the posting doesn't make remote status clear — this
  // must not discard the rest of an otherwise well-formed response.
  it('coalesces a null remote field to false instead of rejecting the whole response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              role: 'Backend Engineer',
              level: 'Senior',
              skills: ['typescript'],
              salaryMin: null,
              salaryMax: null,
              remote: null,
              eligibleRegions: [],
              confidence: 0.9,
            }),
          },
        },
      ],
    });

    const result = await parseJobFields({
      title: 'Senior Backend Engineer',
      description: 'Build our platform.',
      tags: [],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.remote).toBe(false);
    expect(result.role).toBe('Backend Engineer');
    expect(result.confidence).toBe(0.9);
  });

  it('falls back to a confidence=0 result after two failed attempts instead of throwing', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });

    const result = await parseJobFields({
      title: 'Backend Engineer',
      description: 'Some job description text here.',
      tags: [],
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBe(0);
    expect(result.role).toBe('');
    expect(result.skills).toEqual([]);
    expect(result.eligibleRegions).toEqual([]);
  });

  // Unconfigured CHAT_MODEL_FALLBACK must behave exactly like
  // before — no fallback attempt, still 2 calls, still
  // confidence=0.
  it('does not attempt a fallback model when CHAT_MODEL_FALLBACK is unset', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });

    await parseJobFields({ title: 'Backend Engineer', description: 'desc', tags: [] });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'google/gemma-4-26b-a4b-it:free' }),
    );
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
          {
            message: {
              content: JSON.stringify({
                role: 'Backend Engineer',
                level: 'Senior',
                skills: ['node.js'],
                salaryMin: null,
                salaryMax: null,
                remote: true,
                eligibleRegions: [],
                confidence: 0.8,
              }),
            },
          },
        ],
      });

    try {
      const result = await parseJobFields({
        title: 'Backend Engineer',
        description: 'desc',
        tags: [],
      });

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(mockCreate).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ model: 'paid-model' }),
      );
      expect(result.confidence).toBe(0.8);
    } finally {
      delete process.env.CHAT_MODEL_FALLBACK;
      global.fetch = originalFetch;
    }
  });
});
