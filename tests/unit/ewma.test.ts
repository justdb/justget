/**
 * EWMA 速度计算单元测试 / EWMA speed calculation unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  EWMA,
  calculateInstantSpeed,
  calculateAverageSpeed,
  getSpeedStats,
} from '../../src/speed/ewma.js';
import type { SpeedSample } from '../../src/types.js';

describe('EWMA', () => {
  it('returns the first value as-is (initialization)', () => {
    const ewma = new EWMA(0.5);
    expect(ewma.update(100)).toBe(100);
  });

  it('applies alpha smoothing on subsequent updates', () => {
    const ewma = new EWMA(0.5);
    ewma.update(100); // init
    const v2 = ewma.update(200);
    expect(v2).toBe(0.5 * 200 + 0.5 * 100); // 150
    const v3 = ewma.update(200);
    expect(v3).toBe(0.5 * 200 + 0.5 * 150); // 175
    expect(ewma.getValue()).toBe(v3);
  });

  it('high alpha reacts faster than low alpha', () => {
    const fast = new EWMA(0.9);
    const slow = new EWMA(0.1);
    fast.update(10);
    slow.update(10);
    expect(fast.update(100)).toBeGreaterThan(slow.update(100));
  });

  it('reset clears state', () => {
    const ewma = new EWMA(0.5);
    ewma.update(100);
    ewma.update(200);
    ewma.reset();
    expect(ewma.getValue()).toBe(0);
    expect(ewma.update(50)).toBe(50); // re-initialized
  });

  it('rejects invalid alpha', () => {
    expect(() => new EWMA(0)).toThrow(/Alpha/);
    expect(() => new EWMA(1)).toThrow(/Alpha/);
    expect(() => new EWMA(-0.1)).toThrow(/Alpha/);
    expect(() => new EWMA(1.5)).toThrow(/Alpha/);
  });
});

describe('calculateInstantSpeed', () => {
  it('returns 0 with fewer than 2 samples', () => {
    expect(calculateInstantSpeed([])).toBe(0);
    expect(calculateInstantSpeed([{ bytes: 100, timestamp: 0 }])).toBe(0);
  });

  it('computes bytes per second', () => {
    const samples: SpeedSample[] = [
      { bytes: 0, timestamp: 0 },
      { bytes: 1000, timestamp: 1000 },
    ];
    expect(calculateInstantSpeed(samples)).toBe(1000);
  });

  it('returns 0 when timestamps are identical', () => {
    const samples: SpeedSample[] = [
      { bytes: 0, timestamp: 1000 },
      { bytes: 1000, timestamp: 1000 },
    ];
    expect(calculateInstantSpeed(samples)).toBe(0);
  });
});

describe('calculateAverageSpeed', () => {
  it('returns 0 for empty samples', () => {
    expect(calculateAverageSpeed([], 0)).toBe(0);
  });

  it('returns 0 when elapsed time is 0', () => {
    expect(calculateAverageSpeed([{ bytes: 100, timestamp: 1000 }], 1000)).toBe(0);
  });

  it('computes average from start time', () => {
    const samples: SpeedSample[] = [{ bytes: 2000, timestamp: 2000 }];
    expect(calculateAverageSpeed(samples, 0)).toBe(1000);
  });
});

describe('getSpeedStats', () => {
  it('reports current, ewma, peak and average', () => {
    const ewma = new EWMA(0.5);
    const samples: SpeedSample[] = [
      { bytes: 0, timestamp: 0 },
      { bytes: 500, timestamp: 1000 },
      { bytes: 2000, timestamp: 2000 },
    ];
    const stats = getSpeedStats(samples, 0, ewma);
    // 实现取窗口首尾（而非最后两点）/ implementation uses first-to-last sample
    expect(stats.current).toBe(1000); // (2000-0)/2s
    expect(stats.average).toBe(1000); // 2000/2s
    expect(stats.peak).toBe(1000); // max of running windows
    expect(stats.ewma).toBe(ewma.getValue());
  });
});
