import { describe, it, expect } from 'vitest';
import { toDecision } from '../decision';

describe('toDecision', () => {
  it.each([
    [85, 'APPLY'],
    [75, 'APPLY'],
    [74, 'MAYBE'],
    [50, 'MAYBE'],
    [49, 'SKIP'],
    [0, 'SKIP'],
  ] as const)('score %d -> %s when eligibility is ELIGIBLE', (score, expected) => {
    expect(toDecision(score, 'ELIGIBLE')).toBe(expected);
  });

  it.each([
    [85, 'APPLY'],
    [50, 'MAYBE'],
    [0, 'SKIP'],
  ] as const)('score %d -> %s when eligibility is RESTRICTED', (score, expected) => {
    expect(toDecision(score, 'RESTRICTED')).toBe(expected);
  });

  it.each([100, 85, 75, 50, 0])(
    'overrides to SKIP regardless of score (%d) when eligibility is INELIGIBLE',
    (score) => {
      expect(toDecision(score, 'INELIGIBLE')).toBe('SKIP');
    },
  );
});
