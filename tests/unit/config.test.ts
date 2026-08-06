/**
 * 配置模块单元测试 / config.ts unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  mergeConfig,
  validateConfig,
  isImmediateFailure,
} from '../../src/config.js';
import type { DownloadConfig } from '../../src/types.js';

describe('DEFAULT_CONFIG', () => {
  it('has documented defaults', () => {
    expect(DEFAULT_CONFIG.primaryWarmupTime).toBe(5000);
    expect(DEFAULT_CONFIG.speedThreshold).toBe(512000);
    expect(DEFAULT_CONFIG.fastPrimaryThreshold).toBe(2048000);
    expect(DEFAULT_CONFIG.sizeThreshold).toBe(52428800);
    expect(DEFAULT_CONFIG.minReplaceTime).toBe(30000);
    expect(DEFAULT_CONFIG.replaceCheckInterval).toBe(10000);
    expect(DEFAULT_CONFIG.chunks).toBe('auto');
    expect(DEFAULT_CONFIG.chunkSize).toBe('auto');
    expect(DEFAULT_CONFIG.minChunkSize).toBe(1048576);
    expect(DEFAULT_CONFIG.retries).toBe(3);
    expect(DEFAULT_CONFIG.retryDelay).toBe(2000);
    expect(DEFAULT_CONFIG.timeout).toBe(300000);
    expect(DEFAULT_CONFIG.connectTimeout).toBe(10000);
    expect(DEFAULT_CONFIG.checksumAlgorithm).toBe('sha256');
  });
});

describe('mergeConfig', () => {
  it('returns full defaults when no config given', () => {
    expect(mergeConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it('merges user config over defaults', () => {
    const merged = mergeConfig({ chunks: 4, speedThreshold: 1000 });
    expect(merged.chunks).toBe(4);
    expect(merged.speedThreshold).toBe(1000);
    expect(merged.primaryWarmupTime).toBe(DEFAULT_CONFIG.primaryWarmupTime);
  });

  it('does not mutate the input', () => {
    const input: DownloadConfig = { chunks: 2 };
    mergeConfig(input);
    expect(input).toEqual({ chunks: 2 });
  });
});

describe('validateConfig', () => {
  it('accepts defaults', () => {
    expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it('rejects negative numbers', () => {
    expect(() => validateConfig({ primaryWarmupTime: -1 })).toThrow(/primaryWarmupTime/);
    expect(() => validateConfig({ speedThreshold: -1 })).toThrow(/speedThreshold/);
    expect(() => validateConfig({ fastPrimaryThreshold: -1 })).toThrow(/fastPrimaryThreshold/);
    expect(() => validateConfig({ sizeThreshold: -1 })).toThrow(/sizeThreshold/);
    expect(() => validateConfig({ minReplaceTime: -1 })).toThrow(/minReplaceTime/);
    expect(() => validateConfig({ replaceCheckInterval: -1 })).toThrow(/replaceCheckInterval/);
    expect(() => validateConfig({ connectTimeout: -1 })).toThrow(/connectTimeout/);
    expect(() => validateConfig({ retries: -1 })).toThrow(/retries/);
    expect(() => validateConfig({ timeout: -1 })).toThrow(/timeout/);
  });

  it('rejects zero/negative chunk counts and sizes', () => {
    expect(() => validateConfig({ chunks: 0 })).toThrow(/chunks/);
    expect(() => validateConfig({ chunkSize: 0 })).toThrow(/chunkSize/);
    expect(() => validateConfig({ minChunkSize: 0 })).toThrow(/minChunkSize/);
    expect(() => validateConfig({ chunks: 'auto' })).not.toThrow();
    expect(() => validateConfig({ chunkSize: 'auto' })).not.toThrow();
  });

  it('rejects unknown checksum algorithms', () => {
    expect(() => validateConfig({ checksumAlgorithm: 'crc32' as never })).toThrow(/checksumAlgorithm/);
    expect(() => validateConfig({ checksumAlgorithm: 'md5' })).not.toThrow();
    expect(() => validateConfig({ checksumAlgorithm: 'sha512' })).not.toThrow();
  });
});

describe('isImmediateFailure', () => {
  it('treats listed HTTP statuses as immediate failures', () => {
    for (const status of [404, 401, 403, 410, 500, 502, 503, 504]) {
      expect(isImmediateFailure(new Error('any'), status)).toBe(true);
    }
  });

  it('treats all 5xx as immediate failures (server errors -> mirror handover)', () => {
    for (const status of [500, 501, 502, 503, 504, 505, 511, 599]) {
      expect(isImmediateFailure(new Error('any'), status)).toBe(true);
    }
  });

  it('does not treat 2xx/3xx or unlisted statuses as immediate failures', () => {
    expect(isImmediateFailure(new Error('any'), 200)).toBe(false);
    expect(isImmediateFailure(new Error('any'), 301)).toBe(false);
    expect(isImmediateFailure(new Error('any'), 429)).toBe(false);
  });

  it('treats network error codes as immediate failures', () => {
    for (const code of ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']) {
      const err = new Error('network') as Error & { code?: string };
      err.code = code;
      expect(isImmediateFailure(err)).toBe(true);
    }
  });

  it('matches failure patterns in messages', () => {
    expect(isImmediateFailure(new Error('connection refused by host'))).toBe(true);
    expect(isImmediateFailure(new Error('network unreachable'))).toBe(true);
    expect(isImmediateFailure(new Error('host unreachable'))).toBe(true);
    expect(isImmediateFailure(new Error('Request aborted'))).toBe(true);
    expect(isImmediateFailure(new Error('cancelled by user'))).toBe(true);
    expect(isImmediateFailure(new Error('request timeout'))).toBe(true);
  });

  it('does not treat the overall download timeout as immediate failure', () => {
    expect(isImmediateFailure(new Error('Download timeout / 下载超时 (900000ms)'))).toBe(false);
    expect(isImmediateFailure(new Error('nothing wrong here'))).toBe(false);
  });
});
