import { auth } from '@/lib/auth';
import { prisma } from '@ai-job-market-intelligence/db';
import { ScoreResponseSchema } from '@ai-job-market-intelligence/shared';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError('UNAUTHORIZED', 401);
  }

  const { id } = await params;
  const score = await prisma.jobScore.findUnique({
    where: { jobId_userId: { jobId: id, userId: session.user.id } },
  });
  if (!score) {
    return apiError('NOT_FOUND', 404, undefined, 'Score not yet available for this job');
  }

  const data = ScoreResponseSchema.parse({
    score: score.score,
    decision: score.decision,
    eligibility: score.eligibility,
    reasoning: score.reasoning,
    strengths: score.strengths,
    skillGap: score.skillGap,
    breakdown: {
      llmScore: score.llmScore,
      embeddingScore: score.embeddingScore,
      ruleScore: score.ruleScore,
    },
    scoringVersion: score.scoringVersion,
    createdAt: score.createdAt.toISOString(),
  });

  return apiSuccess(data);
}
