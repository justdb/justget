/**
 * JustGet 默认配置
 * Default configuration for JustGet downloader
 */

import type { DownloadConfig } from './types.js';

/**
 * 默认配置中可被完整默认化的字段（回调与校验和由调用方提供）
 * Fields that always have defaults; callbacks/checksum are caller-provided
 */
type DefaultConfig = Required<
  Omit<DownloadConfig, 'checksum' | 'onProgress' | 'onComplete' | 'onError'>
>;

/**
 * Default download configuration
 */
export const DEFAULT_CONFIG: DefaultConfig = {
  primaryWarmupTime: 5000,          // 5 seconds
  speedThreshold: 512000,           // 500 KB/s (below this, consider mirrors)
  fastPrimaryThreshold: 2048000,    // 2 MB/s (above this, don't start mirrors)
  sizeThreshold: 52428800,          // 50 MB
  minReplaceTime: 30000,            // 30 seconds
  replaceCheckInterval: 10000,      // 10 seconds
  chunks: 'auto',
  chunkSize: 'auto',
  minChunkSize: 1048576,            // 1 MB
  retries: 3,
  retryDelay: 2000,
  timeout: 300000,                  // 5 minutes
  connectTimeout: 10000,            // 10 seconds
  checksumAlgorithm: 'sha256',
};

/**
 * Configuration for speed calculation
 */
export const SPEED_CONFIG = {
  ewmaAlpha: 0.3,        // EWMA smoothing factor
  sampleInterval: 1000,  // Sample every 1 second
  windowSize: 10,        // Keep last 10 samples
};

/**
 * Configuration for chunk strategy
 */
export const CHUNK_STRATEGY_CONFIG = {
  minPrimaryReserve: 0.1,     // Minimum 10% reserved for primary
  maxPrimaryReserve: 0.5,     // Maximum 50% reserved for primary
  basePrimaryReserve: 0.2,    // Base reserve ratio
  sizeFactorMax: 0.1,         // Additional from file size
  speedFactorMax: 0.15,       // Additional from speed
  progressFactorMax: 0.05,    // Additional from progress
};

/**
 * Configuration for source replacement
 */
export const REPLACEMENT_CONFIG = {
  minTimeBeforeReplace: 30000,   // 30 seconds minimum
  checkInterval: 10000,          // Check every 10 seconds
  slowThresholdRatio: 0.33,      // Slow is < 33% of fast
  maxSlowChecks: 3,              // Max consecutive slow checks
  bufferSize: 1048576,           // 1 MB buffer before switch
  immediateFailureCodes: [       // Error codes that trigger immediate mirror start
    'ECONNREFUSED',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
  ],
  immediateFailureHttp: [       // HTTP status codes that trigger immediate mirror start
    404, 401, 403, 410, 500, 502, 503, 504,
  ],
};

/**
 * Configuration for temporary files
 */
export const TEMP_FILE_CONFIG = {
  prefix: '.justget-',
  hashLength: 5,
  maxAgeHours: 1,                // Clean files older than 1 hour
  resumeThreshold: 0.9,          // Resume if >= 90% complete
};

/**
 * Check if an error indicates immediate failure (not just slow)
 * 
 * Immediate failures should trigger mirror start immediately,
 * not wait for warmup timeout.
 */
export function isImmediateFailure(error: Error, httpStatus?: number): boolean {
  // Check HTTP status codes
  if (httpStatus !== undefined) {
    if (REPLACEMENT_CONFIG.immediateFailureHttp.includes(httpStatus)) {
      return true;
    }
  }
  
  // Check error codes
  const code = (error as any).code;
  if (code && REPLACEMENT_CONFIG.immediateFailureCodes.includes(code)) {
    return true;
  }
  
  // Check error message for common failure patterns
  const message = error.message.toLowerCase();
  return (
    message.includes('connection refused') ||
    message.includes('network unreachable') ||
    message.includes('host unreachable') ||
    message.includes('aborted') ||
    message.includes('cancelled') ||
    (message.includes('timeout') && !message.includes('download timeout'))
  );
}

/**
 * Merge user config with defaults
 */
export function mergeConfig(userConfig?: DownloadConfig): DownloadConfig {
  if (!userConfig) {
    return { ...DEFAULT_CONFIG };
  }

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    // Handle nested merges if needed
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: DownloadConfig): void {
  if (config.primaryWarmupTime !== undefined && config.primaryWarmupTime < 0) {
    throw new Error('primaryWarmupTime must be non-negative');
  }

  if (config.speedThreshold !== undefined && config.speedThreshold < 0) {
    throw new Error('speedThreshold must be non-negative');
  }

  if (config.fastPrimaryThreshold !== undefined && config.fastPrimaryThreshold < 0) {
    throw new Error('fastPrimaryThreshold must be non-negative');
  }

  if (config.sizeThreshold !== undefined && config.sizeThreshold < 0) {
    throw new Error('sizeThreshold must be non-negative');
  }

  if (config.minReplaceTime !== undefined && config.minReplaceTime < 0) {
    throw new Error('minReplaceTime must be non-negative');
  }

  if (config.replaceCheckInterval !== undefined && config.replaceCheckInterval < 0) {
    throw new Error('replaceCheckInterval must be non-negative');
  }

  if (config.connectTimeout !== undefined && config.connectTimeout < 0) {
    throw new Error('connectTimeout must be non-negative');
  }

  if (config.chunks !== undefined && typeof config.chunks === 'number' && config.chunks < 1) {
    throw new Error('chunks must be at least 1');
  }

  if (config.chunkSize !== undefined && typeof config.chunkSize === 'number' && config.chunkSize < 1) {
    throw new Error('chunkSize must be at least 1');
  }

  if (config.minChunkSize !== undefined && config.minChunkSize < 1) {
    throw new Error('minChunkSize must be at least 1');
  }

  if (config.retries !== undefined && config.retries < 0) {
    throw new Error('retries must be non-negative');
  }

  if (config.timeout !== undefined && config.timeout < 0) {
    throw new Error('timeout must be non-negative');
  }

  if (
    config.checksumAlgorithm !== undefined &&
    !['md5', 'sha1', 'sha256', 'sha512'].includes(config.checksumAlgorithm)
  ) {
    throw new Error(`Unsupported checksumAlgorithm: ${config.checksumAlgorithm}`);
  }
}