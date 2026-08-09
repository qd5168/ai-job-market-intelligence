import { useTranslations } from 'next-intl';
import type { JobListItem } from '@ai-job-market-intelligence/shared';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { ScoreRing } from './score-ring';
import { SourceAttribution } from './source-attribution';
import { ApplicationBadge } from './application-badge';
import { EligibilityBadge } from './eligibility-badge';

export function JobCard({ job }: { job: JobListItem }) {
  const t = useTranslations('jobs');

  function timeAgo(iso: string | null): string {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return t('todayLabel');
    return t('dayAgo', { count: days });
  }

  return (
    <Card
      data-testid="job-card"
      className="relative flex items-center gap-4 p-4 transition-colors hover:bg-accent/50"
    >
      {/* Stretched-link pattern: the whole card is clickable, but
          SourceAttribution below still renders a real, independently
          clickable <a> instead of being nested inside this one. */}
      <Link href={`/jobs/${job.id}`} className="absolute inset-0" aria-label={job.title} />
      <div className="min-w-0 flex-1 space-y-1">
        {job.application && (
          <span className="pointer-events-none inline-block">
            <ApplicationBadge status={job.application.status} />
          </span>
        )}
        <p className="truncate font-medium">{job.title}</p>
        <p className="truncate text-sm text-muted-foreground">
          {job.company} · {job.location}
          {job.postedAt && ` · ${timeAgo(job.postedAt)}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pointer-events-none inline-block">
            <EligibilityBadge eligibility={job.score.eligibility} />
          </span>
          {job.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-xs text-muted-foreground">
              {tag}
            </span>
          ))}
          <span className="relative z-10">
            <SourceAttribution source={job.source} />
          </span>
        </div>
      </div>
      <ScoreRing score={job.score.value} decision={job.score.decision} />
    </Card>
  );
}
