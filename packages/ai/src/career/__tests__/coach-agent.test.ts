import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import {
  runCareerCoachTurn,
  CareerCoachRateLimitError,
  type CareerCoachMessage,
} from '../coach-agent';

function textResponse(content: string | null) {
  return { choices: [{ message: { content, tool_calls: undefined } }] };
}

function toolCallResponse(name: string, args: Record<string, unknown>, id = 'call_1') {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}

const history: CareerCoachMessage[] = [
  { role: 'user', content: 'What is the salary range for Backend Engineer?' },
];

beforeEach(() => {
  mockCreate.mockReset();
  delete process.env.CAREER_COACH_MAX_TOKENS;
});

describe('runCareerCoachTurn', () => {
  it('returns the direct answer when no tool call is needed', async () => {
    mockCreate.mockResolvedValue(textResponse('Hi, how can I help with your career?'));

    const result = await runCareerCoachTurn(history, vi.fn());

    expect(result).toBe('Hi, how can I help with your career?');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('defaults max_tokens to 3000 when CAREER_COACH_MAX_TOKENS is unset', async () => {
    mockCreate.mockResolvedValue(textResponse('Hi, how can I help with your career?'));

    await runCareerCoachTurn(history, vi.fn());

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 3000 }));
  });

  it('respects a custom CAREER_COACH_MAX_TOKENS value', async () => {
    process.env.CAREER_COACH_MAX_TOKENS = '5000';
    mockCreate.mockResolvedValue(textResponse('Hi, how can I help with your career?'));

    await runCareerCoachTurn(history, vi.fn());

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 5000 }));
  });

  it('prefetches get_job_context and injects the actual job facts into a directive, without asking the model to call it', async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValue({ title: 'Backend Engineer', company: 'Acme', role: 'BACKEND' });
    mockCreate.mockResolvedValue(textResponse('Here is a draft outreach message.'));

    await runCareerCoachTurn(history, executeTool, 'job-123');

    expect(executeTool).toHaveBeenCalledWith({
      name: 'get_job_context',
      arguments: { jobId: 'job-123' },
    });
    const call = mockCreate.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    const directive = call.messages.find(
      (m) => m.role === 'system' && m.content.includes('Backend Engineer'),
    );
    expect(directive).toBeDefined();
    expect(directive!.content).toContain('Acme');
  });

  it('instructs the model to ask the outreach channel before drafting, with channel-specific formatting rules', async () => {
    const executeTool = vi.fn().mockResolvedValue({ title: 'Backend Engineer', company: 'Acme' });
    mockCreate.mockResolvedValue(textResponse('Which channel would you like this for?'));

    await runCareerCoachTurn(history, executeTool, 'job-123');

    const call = mockCreate.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    const directive = call.messages.find(
      (m) => m.role === 'system' && m.content.includes('Backend Engineer'),
    );
    expect(directive!.content).toContain('ask which channel first');
    expect(directive!.content).toMatch(/500 characters/);
    expect(directive!.content).toMatch(/no markdown bullet/);
    expect(directive!.content).toMatch(/no placeholder contact-info block/);
  });

  it('does not inject a job-context directive when get_job_context returns an error', async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValue({ error: 'This job is not associated with the current user.' });
    mockCreate.mockResolvedValue(textResponse('I could not find that job.'));

    await runCareerCoachTurn(history, executeTool, 'job-123');

    const call = mockCreate.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    const systemMessages = call.messages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1); // just CAREER_COACH_SYSTEM_PROMPT
  });

  it('does not inject any job-context directive when jobId is omitted', async () => {
    mockCreate.mockResolvedValue(textResponse('Hi, how can I help with your career?'));

    await runCareerCoachTurn(history, vi.fn());

    const call = mockCreate.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    const systemMessages = call.messages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1); // just CAREER_COACH_SYSTEM_PROMPT
  });

  it('strips markdown bullets, separators, and bracketed placeholders from a private-channel outreach draft', async () => {
    const outreachHistory: CareerCoachMessage[] = [
      { role: 'user', content: 'Help me draft an outreach/networking message for this job.' },
      { role: 'assistant', content: 'Which channel would you like — email or LinkedIn?' },
      { role: 'user', content: 'LinkedIn' },
    ];
    mockCreate.mockResolvedValue(
      textResponse(
        'Hi Hiring Team,\n\n' +
          '- I have strong backend experience.\n' +
          '- I am excited about this role.\n\n' +
          '***\n\n' +
          'Best,\n[Your Name]\n[Link to your Portfolio/GitHub]',
      ),
    );

    // No jobId on this follow-up turn, matching how the real app only
    // carries jobId on the auto-sent first message.
    const result = await runCareerCoachTurn(outreachHistory, vi.fn());

    expect(result).not.toMatch(/^\s*[-*]/m);
    expect(result).not.toContain('***');
    expect(result).not.toContain('[Your Name]');
    expect(result).not.toContain('[Link to your Portfolio/GitHub]');
    expect(result).toContain('I have strong backend experience.');
  });

  it('does not clean an email-channel outreach draft (markdown/placeholders are fine there)', async () => {
    const outreachHistory: CareerCoachMessage[] = [
      { role: 'user', content: 'Help me draft an outreach/networking message for this job.' },
      { role: 'assistant', content: 'Which channel would you like — email or LinkedIn?' },
      { role: 'user', content: 'Email' },
    ];
    const draft = '- Strong backend experience.\n\nBest,\n[Your Name]';
    mockCreate.mockResolvedValue(textResponse(draft));

    const result = await runCareerCoachTurn(outreachHistory, vi.fn());

    expect(result).toBe(draft);
  });

  it('does not clean the first (channel-asking) outreach turn', async () => {
    // No prior assistant reply in history yet — this is the very first
    // model call for this job, so the response is the channel question,
    // not a draft, and nothing should be stripped.
    mockCreate.mockResolvedValue(
      textResponse('Which channel — Email or LinkedIn?\n- Email\n- LinkedIn'),
    );

    const result = await runCareerCoachTurn(
      [{ role: 'user', content: 'Help me draft an outreach/networking message for this job.' }],
      vi.fn(),
      'job-123',
    );

    expect(result).toContain('- Email');
  });

  it('does not clean a normal (non-outreach) conversation response', async () => {
    mockCreate.mockResolvedValue(
      textResponse('Here are 2 career paths:\n- Backend Engineer\n- Platform Engineer'),
    );

    const result = await runCareerCoachTurn(history, vi.fn());

    expect(result).toContain('- Backend Engineer');
  });

  it('executes the requested tool and feeds the result back for the final answer', async () => {
    const executeTool = vi.fn().mockResolvedValue({ min: 90000, max: 150000, median: 120000 });
    mockCreate
      .mockResolvedValueOnce(toolCallResponse('get_salary_range', { role: 'Backend Engineer' }))
      .mockResolvedValueOnce(
        textResponse('Backend Engineers typically earn $90k-$150k, median $120k.'),
      );

    const result = await runCareerCoachTurn(history, executeTool);

    expect(executeTool).toHaveBeenCalledWith({
      name: 'get_salary_range',
      arguments: { role: 'Backend Engineer' },
    });
    expect(result).toBe('Backend Engineers typically earn $90k-$150k, median $120k.');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('feeds the tool result back as a tool-role message referencing the same tool_call_id', async () => {
    const executeTool = vi.fn().mockResolvedValue({ insufficientData: true });
    mockCreate
      .mockResolvedValueOnce(
        toolCallResponse('get_salary_range', { role: 'Rare Role' }, 'call_xyz'),
      )
      .mockResolvedValueOnce(textResponse('Not enough data for that role yet.'));

    await runCareerCoachTurn(history, executeTool);

    const secondCallMessages = mockCreate.mock.calls[1]![0].messages;
    const toolMessage = secondCallMessages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMessage).toMatchObject({
      tool_call_id: 'call_xyz',
      content: JSON.stringify({ insufficientData: true }),
    });
  });

  it('supports multiple tool-call rounds before answering', async () => {
    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    mockCreate
      .mockResolvedValueOnce(toolCallResponse('get_career_paths', {}, 'call_1'))
      .mockResolvedValueOnce(toolCallResponse('get_skill_trend', { skill: 'Rust' }, 'call_2'))
      .mockResolvedValueOnce(textResponse('Based on both, here is my advice.'));

    const result = await runCareerCoachTurn(history, executeTool);

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result).toBe('Based on both, here is my advice.');
  });

  it('throws once the tool-call loop exceeds the max round count', async () => {
    mockCreate.mockResolvedValue(toolCallResponse('get_skill_trend', { skill: 'Rust' }));

    await expect(runCareerCoachTurn(history, vi.fn().mockResolvedValue({}))).rejects.toThrow(
      'exceeded max tool-call rounds',
    );
  });

  it('falls back to the reasoning field when content is null and there are no tool calls', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        { message: { content: null, tool_calls: undefined, reasoning: 'Fallback answer' } },
      ],
    });

    const result = await runCareerCoachTurn(history, vi.fn());

    expect(result).toBe('Fallback answer');
  });

  it('throws when the model returns no usable content at all', async () => {
    mockCreate.mockResolvedValue(textResponse(null));

    await expect(runCareerCoachTurn(history, vi.fn())).rejects.toThrow('empty response');
  });

  it('converts a 429 from the LLM call into a distinguishable CareerCoachRateLimitError', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));

    await expect(runCareerCoachTurn(history, vi.fn())).rejects.toBeInstanceOf(
      CareerCoachRateLimitError,
    );
  });

  it('rethrows a non-rate-limit error from the LLM call as-is', async () => {
    mockCreate.mockRejectedValue(new Error('some other API error'));

    await expect(runCareerCoachTurn(history, vi.fn())).rejects.toThrow('some other API error');
  });

  // Falls straight to the
  // fallback check on a 429 (no point retrying a daily quota exhaustion),
  // then uses CAREER_COACH_MODEL_FALLBACK once configured and within budget.
  it('uses CAREER_COACH_MODEL_FALLBACK after a 429, when configured', async () => {
    process.env.CAREER_COACH_MODEL_FALLBACK = 'paid-coach-model';
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { total_credits: 10, total_usage: 5 } }),
    }) as unknown as typeof fetch;

    mockCreate
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce(textResponse('Answer from the fallback model.'));

    try {
      const result = await runCareerCoachTurn(history, vi.fn());

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ model: 'paid-coach-model' }),
      );
      expect(result).toBe('Answer from the fallback model.');
    } finally {
      delete process.env.CAREER_COACH_MODEL_FALLBACK;
      global.fetch = originalFetch;
    }
  });

  it('still throws CareerCoachRateLimitError on a 429 when no fallback is configured (unchanged behavior)', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));

    await expect(runCareerCoachTurn(history, vi.fn())).rejects.toBeInstanceOf(
      CareerCoachRateLimitError,
    );
    expect(mockCreate).toHaveBeenCalledTimes(1); // 429 skips the second primary attempt too
  });
});
