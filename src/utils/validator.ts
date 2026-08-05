/**
 * File validation utilities
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { access, stat } from 'node:fs/promises';
import type { ValidationResult } from '../types.js';

/**
 * Calculate file checksum
 */
export async function calculateChecksum(
  filePath: string,
  algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512' = 'sha256'
): Promise<string> {
  const hash = crypto.createHash(algorithm);
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Validate file against expected checksum
 */
export async function validateFile(
  filePath: string,
  expectedChecksum: string,
  algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512' = 'sha256'
): Promise<ValidationResult> {
  try {
    // Check if file exists
    try {
      await access(filePath);
    } catch {
      return {
        valid: false,
        expected: expectedChecksum,
        error: 'File does not exist',
      };
    }

    const actual = await calculateChecksum(filePath, algorithm);
    const valid = actual.toLowerCase() === expectedChecksum.toLowerCase();

    return {
      valid,
      actual,
      expected: expectedChecksum,
    };
  } catch (error) {
    return {
      valid: false,
      expected: expectedChecksum,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get file size
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await stat(filePath);
  return stats.size;
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}