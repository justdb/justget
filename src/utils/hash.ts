/**
 * Temporary file naming and management utilities
 */

import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { TEMP_FILE_CONFIG } from '../config.js';

/**
 * Generate a short hash for a string
 */
export function generateShortHash(input: string, length: number = TEMP_FILE_CONFIG.hashLength): string {
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return hash.slice(0, length);
}

/**
 * Get temporary file name for a chunk
 *
 * Format: .justget-{basename}-{hash}-{source}-{chunk}.{ext}
 */
export function getTempFileName(
  originalName: string,
  sourceId: string,
  chunkIndex: number
): string {
  const basename = path.basename(originalName);
  const ext = path.extname(originalName);
  const nameWithoutExt = ext ? basename.slice(0, -ext.length) : basename;
  const hash = generateShortHash(originalName);

  return `${TEMP_FILE_CONFIG.prefix}${nameWithoutExt}-${hash}-${sourceId}-${chunkIndex}${ext}`;
}

/**
 * Get merged temporary file name
 *
 * Format: .justget-{basename}-{hash}.merged{ext}
 */
export function getMergedTempFileName(originalName: string): string {
  const basename = path.basename(originalName);
  const ext = path.extname(originalName);
  const nameWithoutExt = ext ? basename.slice(0, -ext.length) : basename;
  const hash = generateShortHash(originalName);

  return `${TEMP_FILE_CONFIG.prefix}${nameWithoutExt}-${hash}.merged${ext}`;
}

/**
 * Get the directory for temporary files
 */
export function getTempDir(targetPath: string): string {
  return path.dirname(path.resolve(targetPath));
}

/**
 * Check if a path is a JustGet temporary file
 */
export function isTempFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return basename.startsWith(TEMP_FILE_CONFIG.prefix);
}

/**
 * 分块临时文件：.justget-{name}-{hash}-{source}-{index}{ext}
 * Chunk temp file pattern
 */
const CHUNK_TEMP_RE = /^\.justget-(.+)-([0-9a-f]{5,})-([^-]+)-(\d+)(\.[^.]*)?$/;

/**
 * merged 临时文件：.justget-{name}-{hash}.merged{ext}
 * Merged temp file pattern
 */
const MERGED_TEMP_RE = /^\.justget-(.+)-([0-9a-f]{5,})\.merged(\.[^.]*)?$/;

/**
 * Get base original filename from temp filename
 * 支持分块与 merged 两种格式 / supports both chunk and merged formats
 */
export function getOriginalFromTemp(tempPath: string): string {
  const basename = path.basename(tempPath);
  const chunkMatch = CHUNK_TEMP_RE.exec(basename);
  if (chunkMatch) return chunkMatch[1] + (chunkMatch[5] ?? '');
  const mergedMatch = MERGED_TEMP_RE.exec(basename);
  if (mergedMatch) return mergedMatch[1] + (mergedMatch[3] ?? '');
  return basename;
}

/**
 * Extract hash from temp filename
 * 支持分块与 merged 两种格式 / supports both chunk and merged formats
 */
export function getHashFromTemp(tempPath: string): string | null {
  const basename = path.basename(tempPath);
  const chunkMatch = CHUNK_TEMP_RE.exec(basename);
  if (chunkMatch) return chunkMatch[2];
  const mergedMatch = MERGED_TEMP_RE.exec(basename);
  if (mergedMatch) return mergedMatch[2];
  return null;
}