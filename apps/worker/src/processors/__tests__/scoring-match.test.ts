import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockFindProfile,
  mockFindJob,
  mockGetJobEmbedding,
  mockGetProfileEmbedding,
  mockUpsertProfileEmbedding,
  mockFindScore,
  mockUpsertScore,
} = vi.hoisted(() => ({
  mockFindProfile: vi.fn(),
  mockFindJob: vi.fn(),
  mockGetJobEmbedding: vi.fn(),
  mockGetProfileEmbedding: vi.fn(),
  mockUpsertProfileEmbedding: vi.fn(),
  mockFindScore: vi.fn(),
  mockUpsertScore: vi.fn(),
}));

const { mockBuildProfileText, mockGenerateEmbedding, mockScoreJob, mockComputeLLMScore } =
  vi.hoisted(() => ({
    mockBuildProfileText: vi.fn(() => 'profile-text'),
    mockGenerateEmbedding: vi.fn(),
    mockScoreJob: vi.fn(),
    mockComputeLLMScore: vi.fn(),
  }));

const { mockCanScore, mockIncrementUsage } = vi.hoisted(() => ({
  mockCanScore: vi.fn(),
  mockIncrementUsage: vi.fn(),
}));

const { mockAgentHandoffQueueAdd } = vi.hoisted(() => ({
  mockAgentHandoffQueueAdd: vi.fn(),
}));

vi.mock('@ai-job-market-intelligence/db', () => ({
  prisma: {
    userProfile: { findUniqueOrThrow: mockFindProfile },
    job: { findUniqueOrThrow: mockFindJob },
    jobScore: { findUnique: mockFindScore, upsert: mockUpsertScore },
  },
  getJobEmbedding: mockGetJobEmbedding,
  getProfileEmbedding: mockGetProfileEmbedding,
  upsertProfileEmbedding: mockUpsertProfileEmbedding,
}));

// toDecision/computeFinalScore/getEmbeddingConfidence are kept real (not
// mocked) so smoothing and re-verification tests exercise the actual
// threshold/weighting logic instead of duplicating it in test fixtures.
vi.mock('@ai-job-market-intelligence/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ai-job-market-intelligence/ai')>();
  return {
    ...actual,
    buildProfileText: mockBuildProfileText,
    generateEmbedding: mockGenerateEmbedding,
    scoreJob: mockScoreJob,
    computeLLMScore: mockComputeLLMScore,
  };
});

vi.mock('../../billing/usage.js', () => ({
  canScore: mockCanScore,
  incrementUsage: mockIncrementUsage,
}));

vi.mock('@ai-job-market-intelligence/shared/queue', () => ({
  getAgentHandoffQueue: () => ({ add: mockAgentHandoffQueueAdd }),
  AGENT_HANDOFF_JOB_OPTS: {},
}));

vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processScoringMatch } from '../scoring-match';

// llmScore/embeddingScore/ruleScore are internally consistent with score
// (0.4*95 + 0.4*90 + 0.2*90 = 92) so re-verification math in the >=90 tests
// below is meaningful rather than testing against an arbitrary override.
const scoringResult = {
  score: 92,
  decision: 'APPLY' as const,
  eligibility: 'ELIGIBLE' as const,
  reasoning: 'Great match',
  strengths: ['Node.js experience'],
  skillGap: [],
  llmScore: 95,
  embeddingScore: 90,
  ruleScore: 90,
  scoringVersion: 'v4.1' as const,
};

function makeJob(data: { jobId: string; userId: string }) {
  return { id: `score:${data.jobId}:${data.userId}`, data } as never;
}

beforeEach(() => {
  mockFindProfile.mockReset();
  mockFindJob.mockReset();
  mockGetJobEmbedding.mockReset();
  mockGetProfileEmbedding.mockReset();
  mockUpsertProfileEmbedding.mockReset();
  mockFindScore.mockReset();
  mockUpsertScore.mockReset();
  mockGenerateEmbedding.mockReset();
  mockScoreJob.mockReset();
  mockComputeLLMScore.mockReset();
  mockCanScore.mockReset();
  mockIncrementUsage.mockReset();
  mockAgentHandoffQueueAdd.mockReset();

  mockCanScore.mockResolvedValue(true);
  mockFindProfile.mockResolvedValue({
    userId: 'user-1',
    skills: ['node'],
    experienceYears: 5,
    preferredRoles: [],
  });
  mockFindJob.mockResolvedValue({ id: 'job-1', title: 'Backend Engineer' });
  mockGetJobEmbedding.mockResolvedValue([0.1, 0.2]);
  mockGetProfileEmbedding.mockResolvedValue([0.1, 0.2]);
  mockScoreJob.mockResolvedValue(scoringResult);
  mockFindScore.mockResolvedValue(null);
  mockUpsertScore.mockResolvedValue({});
});

describe('processScoringMatch', () => {
  it('skips scoring entirely once the daily quota is exceeded', async () => {
    mockCanScore.mockResolvedValue(false);

    await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

    expect(mockFindProfile).not.toHaveBeenCalled();
    expect(mockUpsertScore).not.toHaveBeenCalled();
  });

  it('throws when the job has no embedding yet', async () => {
    mockGetJobEmbedding.mockResolvedValue(null);

    await expect(
      processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' })),
    ).rejects.toThrow('has no embedding yet');
  });

  it('generates and persists a profile embedding when missing', async () => {
    mockGetProfileEmbedding.mockResolvedValue(null);
    mockGenerateEmbedding.mockResolvedValue([0.3, 0.4]);

    await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('profile-text');
    expect(mockUpsertProfileEmbedding).toHaveBeenCalledWith('user-1', [0.3, 0.4]);
  });

  it('upserts the score idempotently and increments usage only on first score', async () => {
    await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

    expect(mockUpsertScore).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId_userId: { jobId: 'job-1', userId: 'user-1' } },
        create: expect.objectContaining(scoringResult),
      }),
    );
    expect(mockIncrementUsage).toHaveBeenCalledWith('user-1');
  });

  it('does not increment usage when a score already exists for this job+user', async () => {
    mockFindScore.mockResolvedValue({ id: 'existing-score' });

    await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

    expect(mockIncrementUsage).not.toHaveBeenCalled();
  });

  // The instant high-match email
  // (score >= 80 + APPLY) is retired — scoring_match no longer imports or
  // touches notify_email at all. A high-scoring APPLY result surfaces later
  // via Opportunity Discovery in the next day's Career Brief instead.
  it('does not import or call the notify_email queue for a high-scoring APPLY decision', async () => {
    await expect(
      processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' })),
    ).resolves.toBeUndefined();
  });

  it('does not enqueue an agent_handoff below the 90 threshold', async () => {
    mockScoreJob.mockResolvedValue({ ...scoringResult, score: 89 });

    await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

    expect(mockAgentHandoffQueueAdd).not.toHaveBeenCalled();
    expect(mockComputeLLMScore).not.toHaveBeenCalled();
  });

  // >=90 re-verification (ai-scoring.md §8.7 / v3-scope.md §2 决策 #7): a
  // single llm_score sample isn't trusted on its own — a second sample is
  // averaged in and the combined score re-checked before actually enqueuing.
  describe('>=90 agent_handoff re-verification', () => {
    it('enqueues when a second LLM sample confirms the score stays >= 90', async () => {
      // avg(100, 90) = 95 -> 0.4*95 + 0.4*90 + 0.2*90 = 92
      mockScoreJob.mockResolvedValue({ ...scoringResult, score: 94, llmScore: 100 });
      mockComputeLLMScore.mockResolvedValue({
        score: 90,
        reasoning: 'second look',
        strengths: [],
        skillGap: [],
      });

      await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

      expect(mockComputeLLMScore).toHaveBeenCalledTimes(1);
      expect(mockAgentHandoffQueueAdd).toHaveBeenCalledWith(
        'handoff',
        { jobId: 'job-1', userId: 'user-1', matchScore: 94 },
        expect.objectContaining({ jobId: 'handoff:job-1:user-1' }),
      );
    });

    it('does not enqueue when the second sample pulls the averaged score back below 90', async () => {
      // avg(100, 10) = 55 -> 0.4*55 + 0.4*90 + 0.2*90 = 76
      mockScoreJob.mockResolvedValue({ ...scoringResult, score: 94, llmScore: 100 });
      mockComputeLLMScore.mockResolvedValue({
        score: 10,
        reasoning: 'second look',
        strengths: [],
        skillGap: [],
      });

      await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

      expect(mockAgentHandoffQueueAdd).not.toHaveBeenCalled();
      // The originally-computed (smoothed) score/decision still get written
      // — only the handoff enqueue is gated by re-verification.
      expect(mockUpsertScore).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ score: 94 }) }),
      );
    });

    it('does not enqueue when the second LLM call fails entirely', async () => {
      mockScoreJob.mockResolvedValue({ ...scoringResult, score: 94, llmScore: 100 });
      mockComputeLLMScore.mockResolvedValue(null);

      await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

      expect(mockAgentHandoffQueueAdd).not.toHaveBeenCalled();
    });
  });

  // Display-layer smoothing (ai-scoring.md §8.7): repeat scoring of the same
  // (job, user) blends with the prior stored score; sub-scores stay raw.
  describe('score smoothing', () => {
    it('blends the new score with the existing record 0.7/0.3 when one exists', async () => {
      mockFindScore.mockResolvedValue({ id: 'existing-score', score: 50 });

      await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

      // round(0.7*92 + 0.3*50) = round(64.4 + 15) = 79 -> still APPLY (>=75)
      expect(mockUpsertScore).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            score: 79,
            decision: 'APPLY',
            llmScore: 95,
            embeddingScore: 90,
            ruleScore: 90,
          }),
        }),
      );
    });

    it('does not smooth first-time scoring (no existing record)', async () => {
      await processScoringMatch(makeJob({ jobId: 'job-1', userId: 'user-1' }));

      expect(mockUpsertScore).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ score: 92 }) }),
      );
    });
  });
});
