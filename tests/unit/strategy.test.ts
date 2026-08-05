/**
 * 分块策略单元测试 / chunk strategy unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  calculateChunkStrategy,
  calculateChunkSize,
  calculateChunkCount,
  createChunkRanges,
} from '../../src/chunks/strategy.js';

describe('calculateChunkStrategy', () => {
  it('clamps to the valid reserve range', () => {
    const s = calculateChunkStrategy(0, 0, 0);
    expect(s.primaryReserve).toBeGreaterThanOrEqual(0.1);
    expect(s.primaryReserve).toBeLessThanOrEqual(0.5);
    expect(s.mirrorStart).toBe(s.primaryReserve);

    const big = calculateChunkStrategy(1024 * 1024 * 1024, 1024 * 1024 * 10, 1);
    expect(big.primaryReserve).toBeLessThanOrEqual(0.5);
  });

  it('increases reserve with larger files / faster speed / more progress', () => {
    const small = calculateChunkStrategy(1 * 1024 * 1024, 100 * 1024, 0.1);
    const large = calculateChunkStrategy(200 * 1024 * 1024, 2 * 1024 * 1024, 0.9);
    expect(large.primaryReserve).toBeGreaterThan(small.primaryReserve);
  });
});

describe('calculateChunkSize', () => {
  it('auto: <10MB downloads as a single chunk', () => {
    expect(calculateChunkSize(5 * 1024 * 1024, 'auto')).toBe(5 * 1024 * 1024);
  });

  it('auto: 10-100MB uses up to 4 chunks', () => {
    expect(calculateChunkSize(50 * 1024 * 1024, 'auto')).toBe(Math.ceil((50 * 1024 * 1024) / 4));
  });

  it('auto: 100MB-1GB uses up to 8 chunks', () => {
    expect(calculateChunkSize(500 * 1024 * 1024, 'auto')).toBe(Math.ceil((500 * 1024 * 1024) / 8));
  });

  it('auto: >1GB uses up to 16 chunks', () => {
    expect(calculateChunkSize(2 * 1024 * 1024 * 1024, 'auto')).toBe(Math.ceil((2 * 1024 * 1024 * 1024) / 16));
  });

  it('explicit chunk count divides the file', () => {
    const size = 1024 * 1024 * 100;
    expect(calculateChunkSize(size, 4)).toBe(size / 4);
  });

  it('respects a custom minimum chunk size', () => {
    const size = 1000;
    expect(calculateChunkSize(size, 4)).toBe(1024 * 1024); // default min 1MB
    expect(calculateChunkSize(size, 4, 100)).toBe(250); // custom min 100B
  });
});

describe('calculateChunkCount', () => {
  it('auto chunk size yields matching count', () => {
    const size = 50 * 1024 * 1024;
    const chunkSize = calculateChunkSize(size, 'auto');
    expect(calculateChunkCount(size, 'auto')).toBe(Math.ceil(size / chunkSize));
  });

  it('explicit chunk size yields ceil division', () => {
    expect(calculateChunkCount(100, 30)).toBe(4);
    expect(calculateChunkCount(100, 100)).toBe(1);
    expect(calculateChunkCount(101, 100)).toBe(2);
  });
});

describe('createChunkRanges', () => {
  it('produces contiguous ranges covering the whole file', () => {
    const size = 100;
    const ranges = createChunkRanges(size, 4);
    expect(ranges.length).toBe(4);
    expect(ranges[0][0]).toBe(0);
    expect(ranges[ranges.length - 1][1]).toBe(size - 1);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1);
    }
    const total = ranges.reduce((sum, [s, e]) => sum + (e - s + 1), 0);
    expect(total).toBe(size);
  });

  it('handles sizes not divisible by chunk count', () => {
    const ranges = createChunkRanges(10, 3);
    expect(ranges).toEqual([
      [0, 3],
      [4, 7],
      [8, 9],
    ]);
  });

  it('single chunk covers the whole file', () => {
    expect(createChunkRanges(10, 1)).toEqual([[0, 9]]);
  });
});
