/**
 * Chunk strategy calculation
 */

import type { ChunkStrategy } from '../types.js';
import { CHUNK_STRATEGY_CONFIG } from '../config.js';

/**
 * Calculate chunk strategy based on file size, primary speed, and progress
 *
 * @param fileSize - Total file size in bytes
 * @param primarySpeed - Current primary source speed in bytes/s
 * @param primaryProgress - Primary source progress (0-1)
 * @returns Chunk strategy
 */
export function calculateChunkStrategy(
  fileSize: number,
  primarySpeed: number,
  primaryProgress: number
): ChunkStrategy {
  const cfg = CHUNK_STRATEGY_CONFIG;

  // Size factor: larger files mean less reserve for primary
  const sizeFactor = Math.min(fileSize / (100 * 1024 * 1024), 1);

  // Speed factor: faster primary means more reserve
  const speedFactor = Math.min(primarySpeed / (1024 * 1024), 1);

  // Progress factor: more progress means more reserve
  const progressFactor = Math.min(primaryProgress, 1);

  // Calculate primary reserve ratio
  let primaryReserve = cfg.basePrimaryReserve
    + sizeFactor * cfg.sizeFactorMax
    + speedFactor * cfg.speedFactorMax
    + progressFactor * cfg.progressFactorMax;

  // Clamp to valid range
  primaryReserve = Math.max(cfg.minPrimaryReserve, Math.min(cfg.maxPrimaryReserve, primaryReserve));

  return {
    primaryReserve,
    mirrorStart: primaryReserve,
  };
}

/**
 * Calculate optimal chunk size
 *
 * @param fileSize - Total file size in bytes
 * @param chunks - Number of chunks or 'auto'
 * @param minChunkSize - Minimum chunk size in bytes (default: 1 MB)
 * @returns Chunk size in bytes
 */
export function calculateChunkSize(
  fileSize: number,
  chunks: number | 'auto',
  minChunkSize?: number
): number {
  const min = minChunkSize ?? 1024 * 1024; // 1 MB default

  if (chunks === 'auto') {
    // Auto-calculate based on file size
    if (fileSize < 10 * 1024 * 1024) {
      // < 10MB: single chunk
      return fileSize;
    } else if (fileSize < 100 * 1024 * 1024) {
      // 10-100MB: 2-4 chunks
      return Math.max(min, Math.ceil(fileSize / 4));
    } else if (fileSize < 1024 * 1024 * 1024) {
      // 100MB-1GB: 4-8 chunks
      return Math.max(min, Math.ceil(fileSize / 8));
    } else {
      // > 1GB: 8-16 chunks
      return Math.max(min * 2, Math.ceil(fileSize / 16));
    }
  } else {
    // Explicit chunk count
    return Math.max(min, Math.ceil(fileSize / chunks));
  }
}

/**
 * Calculate optimal chunk count
 *
 * @param fileSize - Total file size in bytes
 * @param chunkSize - Chunk size in bytes or 'auto'
 * @returns Number of chunks
 */
export function calculateChunkCount(fileSize: number, chunkSize: number | 'auto'): number {
  if (chunkSize === 'auto') {
    chunkSize = calculateChunkSize(fileSize, 'auto');
  }
  return Math.ceil(fileSize / chunkSize);
}

/**
 * Create chunk ranges
 *
 * @param fileSize - Total file size in bytes
 * @param chunkCount - Number of chunks
 * @returns Array of chunk ranges [start, end]
 */
export function createChunkRanges(fileSize: number, chunkCount: number): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  const chunkSize = Math.ceil(fileSize / chunkCount);

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize - 1, fileSize - 1);
    chunks.push([start, end]);
  }

  return chunks;
}