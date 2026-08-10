import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import { parseResumeFields } from '../parse-resume';

beforeEach(() => {
  mockCreate.mockReset();
});

describe('parseResumeFields', () => {
  it('parses a valid LLM JSON response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              skills: ['Python', 'Django'],
              experienceYears: 4,
              summary: 'Backend engineer with Python experience.',
            }),
          },
        },
      ],
    });

    const result = await parseResumeFields('resume text here');

    expect(result).toEqual({
      skills: ['Python', 'Django'],
      experienceYears: 4,
      summary: 'Backend engineer with Python experience.',
    });
  });

  it('returns null after two failed attempts instead of throwing', async () => {
    mockCreate.mockRejectedValue(new Error('down'));

    const result = await parseResumeFields('resume text here');

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
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
                skills: ['Go'],
                experienceYears: 2,
                summary: 'Go developer.',
              }),
            },
          },
        ],
      });

    try {
      const result = await parseResumeFields('resume text here');

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(mockCreate).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ model: 'paid-model' }),
      );
      expect(result?.skills).toEqual(['Go']);
    } finally {
      delete process.env.CHAT_MODEL_FALLBACK;
      global.fetch = originalFetch;
    }
  });
});
