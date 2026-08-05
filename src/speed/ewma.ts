/**
 * Speed calculation using Exponentially Weighted Moving Average (EWMA)
 */

import type { SpeedSample, SpeedStats } from '../types.js';
import { SPEED_CONFIG } from '../config.js';

/**
 * EWMA Calculator for smooth speed estimation
 */
export class EWMA {
  private alpha: number;
  private value: number = 0;
  private initialized: boolean = false;

  constructor(alpha: number = SPEED_CONFIG.ewmaAlpha) {
    if (alpha <= 0 || alpha >= 1) {
      throw new Error('Alpha must be between 0 and 1');
    }
    this.alpha = alpha;
  }

  /**
   * Update EWMA with new value
   */
  update(newValue: number): number {
    if (!this.initialized) {
      this.value = newValue;
      this.initialized = true;
    } else {
      this.value = this.alpha * newValue + (1 - this.alpha) * this.value;
    }
    return this.value;
  }

  /**
   * Get current EWMA value
   */
  getValue(): number {
    return this.value;
  }

  /**
   * Reset EWMA
   */
  reset(): void {
    this.value = 0;
    this.initialized = false;
  }
}

/**
 * Calculate instant speed from samples
 */
export function calculateInstantSpeed(samples: SpeedSample[]): number {
  if (samples.length < 2) {
    return 0;
  }

  const newest = samples[samples.length - 1];
  const oldest = samples[0];
  const timeDiff = newest.timestamp - oldest.timestamp;

  if (timeDiff <= 0) {
    return 0;
  }

  return (newest.bytes - oldest.bytes) / (timeDiff / 1000);
}

/**
 * Calculate average speed from samples
 */
export function calculateAverageSpeed(samples: SpeedSample[], startTime: number): number {
  if (samples.length === 0) {
    return 0;
  }

  const lastSample = samples[samples.length - 1];
  const elapsed = lastSample.timestamp - startTime;

  if (elapsed <= 0) {
    return 0;
  }

  return (lastSample.bytes / elapsed) * 1000;
}

/**
 * Get complete speed statistics
 */
export function getSpeedStats(
  samples: SpeedSample[],
  startTime: number,
  ewma: EWMA
): SpeedStats {
  const current = calculateInstantSpeed(samples);
  const average = calculateAverageSpeed(samples, startTime);

  return {
    current,
    ewma: ewma.getValue(),
    peak: Math.max(current, ...samples.map((_, i) =>
      i > 0 ? calculateInstantSpeed(samples.slice(0, i + 1)) : 0
    )),
    average,
  };
}