/**
 * Speed monitoring for download sources
 */

import type { SpeedStats, SpeedSample } from '../types.js';
import { EWMA, calculateInstantSpeed, getSpeedStats } from './ewma.js';
import { SPEED_CONFIG } from '../config.js';

export interface SpeedMonitorOptions {
  /** EWMA alpha value (default: 0.3) */
  alpha?: number;
  /** Sample interval in ms (default: 1000) */
  sampleInterval?: number;
  /** Window size for samples (default: 10) */
  windowSize?: number;
}

/**
 * Monitor and calculate download speed
 */
export class SpeedMonitor {
  private samples: SpeedSample[] = [];
  private ewma: EWMA;
  private startTime: number;
  private options: Required<SpeedMonitorOptions>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(options: SpeedMonitorOptions = {}) {
    this.options = {
      alpha: options.alpha ?? SPEED_CONFIG.ewmaAlpha,
      sampleInterval: options.sampleInterval ?? SPEED_CONFIG.sampleInterval,
      windowSize: options.windowSize ?? SPEED_CONFIG.windowSize,
    };

    this.ewma = new EWMA(this.options.alpha);
    this.startTime = Date.now();
  }

  /**
   * Record a speed sample
   */
  record(bytes: number): SpeedStats {
    const now = Date.now();
    const sample: SpeedSample = { bytes, timestamp: now };

    this.samples.push(sample);

    // Keep only recent samples within window
    while (this.samples.length > this.options.windowSize) {
      this.samples.shift();
    }

    // Update EWMA
    if (this.samples.length >= 2) {
      const instantSpeed = calculateInstantSpeed(this.samples);
      this.ewma.update(instantSpeed);
    }

    return getSpeedStats(this.samples, this.startTime, this.ewma);
  }

  /**
   * Get current speed statistics
   */
  getStats(): SpeedStats {
    return getSpeedStats(this.samples, this.startTime, this.ewma);
  }

  /**
   * Get current speed (EWMA)
   */
  getCurrentSpeed(): number {
    return this.ewma.getValue();
  }

  /**
   * Check if speed is below threshold
   */
  isBelowThreshold(threshold: number): boolean {
    return this.getCurrentSpeed() < threshold;
  }

  /**
   * Start automatic sampling
   */
  startSampling(getBytes: () => number, callback?: (stats: SpeedStats) => void): void {
    this.interval = setInterval(() => {
      const bytes = getBytes();
      const stats = this.record(bytes);
      callback?.(stats);
    }, this.options.sampleInterval);
  }

  /**
   * Stop automatic sampling
   */
  stopSampling(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /**
   * Reset monitor
   */
  reset(): void {
    this.samples = [];
    this.ewma.reset();
    this.startTime = Date.now();
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }
}