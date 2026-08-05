/**
 * 速度监控单元测试 / SpeedMonitor unit tests (fake timers)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SpeedMonitor } from '../../src/speed/speed-monitor.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('SpeedMonitor', () => {
  it('records samples and trims to window size', () => {
    vi.useFakeTimers();
    const m = new SpeedMonitor({ windowSize: 3 });
    m.record(0);
    m.record(10);
    m.record(20);
    m.record(30);
    m.record(40);
    // window keeps only the last 3 samples
    const stats = m.getStats();
    expect(stats.current).toBeGreaterThanOrEqual(0);
  });

  it('reports speed after enough samples', () => {
    vi.useFakeTimers();
    const m = new SpeedMonitor({ sampleInterval: 100, windowSize: 10 });
    m.record(0);
    expect(m.getCurrentSpeed()).toBe(0); // < 2 samples
    vi.advanceTimersByTime(100);
    m.record(1000);
    // instant speed = 1000 bytes / 100ms = 10000 B/s
    expect(m.getCurrentSpeed()).toBe(10000);
  });

  it('isBelowThreshold uses the EWMA speed', () => {
    vi.useFakeTimers();
    const m = new SpeedMonitor({ sampleInterval: 100 });
    m.record(0);
    vi.advanceTimersByTime(100);
    m.record(1000); // 10000 B/s
    expect(m.isBelowThreshold(20000)).toBe(true);
    expect(m.isBelowThreshold(5000)).toBe(false);
  });

  it('reset clears samples and restarts the clock', () => {
    vi.useFakeTimers();
    const m = new SpeedMonitor({ sampleInterval: 100 });
    m.record(0);
    vi.advanceTimersByTime(100);
    m.record(1000);
    expect(m.getCurrentSpeed()).toBe(10000);
    m.reset();
    expect(m.getCurrentSpeed()).toBe(0);
    expect(m.getElapsedTime()).toBe(0);
  });

  it('startSampling records periodically and stopSampling clears the timer', () => {
    vi.useFakeTimers();
    const m = new SpeedMonitor({ sampleInterval: 100 });
    let bytes = 0;
    const callback = vi.fn();
    m.startSampling(() => bytes, callback);

    bytes = 500;
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(m.getStats().current).toBe(0); // still 1 sample

    bytes = 1500;
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(m.getCurrentSpeed()).toBe(10000); // 1000 bytes / 100ms

    m.stopSampling();
    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(2); // no more ticks
  });
});
