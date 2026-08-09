'use client';

import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ProfileUpdateSchema, type ProfileUpdate } from '@ai-job-market-intelligence/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/navigation';
import { createZodErrorMap } from '@/lib/zod-error-map';
import { TagInput } from './tag-input';
import { CurrentCountrySelect } from './current-country-select';
import { SalaryInput } from './salary-input';
import { updateProfile } from '@/lib/api/user';

const POPULAR_SKILLS = ['Python', 'AWS', 'Docker', 'Kubernetes'];

export function OnboardingForm() {
  const t = useTranslations('onboarding');
  const tValidation = useTranslations('validation');
  const router = useRouter();
  const { update } = useSession();
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProfileUpdate>({
    resolver: zodResolver(ProfileUpdateSchema, {
      path: [],
      async: false,
      errorMap: createZodErrorMap(tValidation),
    }),
    defaultValues: {
      skills: [],
      experienceYears: 0,
      preferredRoles: [],
      currentCountry: null,
      expectedSalaryMin: null,
    },
  });

  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: async () => {
      // The PUT already persisted onboardingCompleted to the database, but a
      // JWT session doesn't auto-refresh — without this, middleware keeps
      // reading the stale value and bounces the /jobs navigation back here.
      await update({ onboardingCompleted: true });
      router.push('/jobs?scoring=true');
    },
  });

  const skills = watch('skills');

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="skills">{t('skillsLabel')}</Label>
        <Controller
          control={control}
          name="skills"
          render={({ field }) => (
            <TagInput
              id="skills"
              value={field.value}
              onChange={field.onChange}
              placeholder={t('skillsPlaceholder')}
              maxTags={50}
            />
          )}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t('popular')}</span>
          {POPULAR_SKILLS.filter((s) => !skills.includes(s)).map((s) => (
            <button
              key={s}
              type="button"
              className="underline hover:text-foreground"
              onClick={() => setValue('skills', [...skills, s], { shouldValidate: true })}
            >
              {s}
            </button>
          ))}
        </div>
        {errors.skills && <p className="text-sm text-destructive">{errors.skills.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="experienceYears">{t('experienceLabel')}</Label>
        <Input
          id="experienceYears"
          type="number"
          min={0}
          max={50}
          className="w-24"
          {...register('experienceYears', { valueAsNumber: true })}
        />
        {errors.experienceYears && (
          <p className="text-sm text-destructive">{errors.experienceYears.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="preferredRoles">{t('rolesLabel')}</Label>
        <Controller
          control={control}
          name="preferredRoles"
          render={({ field }) => (
            <TagInput
              id="preferredRoles"
              value={field.value}
              onChange={field.onChange}
              placeholder={t('rolesPlaceholder')}
              maxTags={10}
              maxTagLength={100}
            />
          )}
        />
        {errors.preferredRoles && (
          <p className="text-sm text-destructive">{errors.preferredRoles.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>{t('currentCountryLabel')}</Label>
        <Controller
          control={control}
          name="currentCountry"
          render={({ field }) => (
            <CurrentCountrySelect value={field.value ?? null} onChange={field.onChange} />
          )}
        />
        <p className="text-xs text-muted-foreground">{t('currentCountryHint')}</p>
        {errors.currentCountry && (
          <p className="text-sm text-destructive">{errors.currentCountry.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="expectedSalaryMin">{t('salaryLabel')}</Label>
        <Controller
          control={control}
          name="expectedSalaryMin"
          render={({ field }) => (
            <SalaryInput
              value={field.value}
              onChange={field.onChange}
              placeholder={t('salaryPlaceholder')}
            />
          )}
        />
        <p className="text-xs text-muted-foreground">{t('salaryHint')}</p>
        {errors.expectedSalaryMin && (
          <p className="text-sm text-destructive">{errors.expectedSalaryMin.message}</p>
        )}
      </div>

      {mutation.isError && <p className="text-sm text-destructive">{t('somethingWrong')}</p>}

      <Button type="submit" disabled={isSubmitting || mutation.isPending}>
        {mutation.isPending ? t('saving') : t('getStarted')}
      </Button>
    </form>
  );
}
