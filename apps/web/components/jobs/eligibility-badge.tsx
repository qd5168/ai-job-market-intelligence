import { useTranslations } from 'next-intl';
import type { JobEligibility } from '@ai-job-market-intelligence/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ELIGIBILITY_STYLES: Record<JobEligibility, string> = {
  ELIGIBLE: 'bg-emerald-100 text-emerald-800',
  RESTRICTED: 'bg-amber-100 text-amber-800',
  INELIGIBLE: 'bg-rose-100 text-rose-800',
};

const ELIGIBILITY_KEYS: Record<JobEligibility, string> = {
  ELIGIBLE: 'eligible',
  RESTRICTED: 'restricted',
  INELIGIBLE: 'ineligible',
};

export function EligibilityBadge({ eligibility }: { eligibility: JobEligibility }) {
  const t = useTranslations('jobs.eligibility');

  return (
    <Badge data-testid="eligibility-badge" className={cn(ELIGIBILITY_STYLES[eligibility])}>
      {t(ELIGIBILITY_KEYS[eligibility])}
    </Badge>
  );
}
