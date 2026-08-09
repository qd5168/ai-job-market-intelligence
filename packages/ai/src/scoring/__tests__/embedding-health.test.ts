import { describe, it, expect, beforeEach } from 'vitest';
import { getEmbeddingConfidence, updateEmbeddingConfidence } from '../embedding-health';

function samples(count: number, embeddingScore: number) {
  return Array.from({ length: count }, () => ({ embeddingScore }));
}

describe('getEmbeddingConfidence / updateEmbeddingConfidence', () => {
  beforeEach(() => {
    // Reset the module-level cache back to its cold-start default (healthy)
    // by feeding it an all-healthy sample before each test.
    updateEmbeddingConfidence(samples(50, 80));
  });

  it('defaults to healthy (1.0) with too few samples to judge', () => {
    expect(updateEmbeddingConfidence(samples(10, 0))).toBe(1.0);
  });

  it('stays healthy when the low-embeddingScore ratio is below the threshold', () => {
    // 30% below 20, well under the 60% unhealthy threshold
    const mixed = [...samples(150, 5), ...samples(350, 60)];
    expect(updateEmbeddingConfidence(mixed)).toBe(1.0);
    expect(getEmbeddingConfidence()).toBe(1.0);
  });

  it('degrades to 0.3 when more than 60% of samples have a low embeddingScore', () => {
    const mostlyLow = [...samples(400, 5), ...samples(100, 80)];
    expect(updateEmbeddingConfidence(mostlyLow)).toBe(0.3);
    expect(getEmbeddingConfidence()).toBe(0.3);
  });

  it('recovers back to 1.0 once a later sample looks healthy again', () => {
    updateEmbeddingConfidence([...samples(400, 5), ...samples(100, 80)]);
    expect(getEmbeddingConfidence()).toBe(0.3);

    updateEmbeddingConfidence(samples(500, 80));
    expect(getEmbeddingConfidence()).toBe(1.0);
  });
});
