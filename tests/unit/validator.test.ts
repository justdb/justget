/**
 * 文件校验工具单元测试 / file validation utilities unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  calculateChecksum,
  validateFile,
  getFileSize,
  fileExists,
} from '../../src/utils/validator.js';

let dir: string;
let file: string;
const content = Buffer.from('justget checksum test payload 1234567890');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justget-val-'));
  file = path.join(dir, 'payload.bin');
  fs.writeFileSync(file, content);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('calculateChecksum', () => {
  it('computes sha256 by default', async () => {
    const expected = crypto.createHash('sha256').update(content).digest('hex');
    expect(await calculateChecksum(file)).toBe(expected);
  });

  it('supports multiple algorithms', async () => {
    for (const algo of ['md5', 'sha1', 'sha256', 'sha512'] as const) {
      const expected = crypto.createHash(algo).update(content).digest('hex');
      expect(await calculateChecksum(file, algo)).toBe(expected);
    }
  });

  it('rejects on missing file', async () => {
    await expect(calculateChecksum(path.join(dir, 'missing.bin'))).rejects.toThrow();
  });
});

describe('validateFile', () => {
  it('validates a matching checksum', async () => {
    const sum = crypto.createHash('sha256').update(content).digest('hex');
    const result = await validateFile(file, sum);
    expect(result.valid).toBe(true);
    expect(result.actual).toBe(sum);
  });

  it('detects a mismatched checksum (case-insensitive expected)', async () => {
    const result = await validateFile(file, '0'.repeat(64));
    expect(result.valid).toBe(false);
    expect(result.actual).toBe(crypto.createHash('sha256').update(content).digest('hex'));
  });

  it('reports missing files', async () => {
    const result = await validateFile(path.join(dir, 'missing.bin'), 'x');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not exist/i);
  });
});

describe('getFileSize / fileExists', () => {
  it('returns the file size', async () => {
    expect(await getFileSize(file)).toBe(content.length);
  });

  it('checks existence', async () => {
    expect(await fileExists(file)).toBe(true);
    expect(await fileExists(path.join(dir, 'missing.bin'))).toBe(false);
  });
});
