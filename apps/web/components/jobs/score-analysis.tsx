import { useTranslations } from 'next-intl';
import type { ScoreResponse } from '@ai-job-market-intelligence/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScoreBadge } from './score-badge';
import { DecisionBadge } from './decision-badge';

export function ScoreAnalysis({
  score,
  isLoading,
}: {
  score: ScoreResponse | null | undefined;
  isLoading: boolean;
}) {
  const t = useTranslations('jobDetail');
  const tEligibility = useTranslations('jobs.eligibility');

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!score) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground" role="status" aria-busy="true">
          {t('analysisInProgress')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="score-analysis">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <ScoreBadge score={score.score} />
          <span className="text-sm text-muted-foreground">{t('outOf100')}</span>
          <DecisionBadge decision={score.decision} />
        </div>
        {score.decision === 'SKIP' && score.eligibility === 'INELIGIBLE' && (
          <p className="text-xs text-muted-foreground">{tEligibility('skipOverrideHint')}</p>
        )}
        <p className="text-sm">{score.reasoning}</p>
        {score.strengths.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">{t('strengths')}</p>
            <div className="flex flex-wrap gap-2">
              {score.strengths.map((point) => (
                <span key={point} className="rounded-md bg-secondary px-2 py-0.5 text-xs">
                  {point}
                </span>
              ))}
            </div>
          </div>
        )}
        {score.skillGap.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">{t('skillGaps')}</p>
            <div className="flex flex-wrap gap-2">
              {score.skillGap.map((skill) => (
                <span key={skill} className="rounded-md bg-secondary px-2 py-0.5 text-xs">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t('breakdown', {
            llmScore: score.breakdown.llmScore,
            embeddingScore: score.breakdown.embeddingScore,
            ruleScore: score.breakdown.ruleScore,
          })}
        </p>
      </CardContent>
    </Card>
  );
}
