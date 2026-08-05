/**
 * 临时文件命名工具单元测试 / temp file naming utilities unit tests
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  generateShortHash,
  getTempFileName,
  getMergedTempFileName,
  getTempDir,
  isTempFile,
  getOriginalFromTemp,
  getHashFromTemp,
} from '../../src/utils/hash.js';

describe('generateShortHash', () => {
  it('is deterministic and hex-encoded', () => {
    const a = generateShortHash('hello');
    const b = generateShortHash('hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{5}$/);
  });

  it('respects the length argument', () => {
    expect(generateShortHash('hello', 8)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('differs for different inputs', () => {
    expect(generateShortHash('a')).not.toBe(generateShortHash('b'));
  });
});

describe('getTempFileName', () => {
  it('builds the documented chunk temp name', () => {
    const name = getTempFileName('/tmp/archive.tar.gz', 'primary', 3);
    const base = path.basename(name);
    expect(base.startsWith('.justget-')).toBe(true);
    // 多段扩展名保留在名字部分 / multi-dot extensions stay in the name part
    expect(base).toMatch(/^\.justget-archive\.tar-[0-9a-f]{5}-primary-3\.gz$/);
  });

  it('keeps the basename of the original path', () => {
    const name = getTempFileName('/a/b/c/file.bin', 'mirror-0', 0);
    expect(path.basename(name)).toMatch(/^\.justget-file-[0-9a-f]{5}-mirror-0-0\.bin$/);
  });

  it('handles names without extension', () => {
    const name = getTempFileName('readme', 'primary', 1);
    expect(path.basename(name)).toMatch(/^\.justget-readme-[0-9a-f]{5}-primary-1$/);
  });
});

describe('getMergedTempFileName', () => {
  it('builds the merged temp name', () => {
    const name = path.basename(getMergedTempFileName('/tmp/data.bin'));
    expect(name).toMatch(/^\.justget-data-[0-9a-f]{5}\.merged\.bin$/);
  });
});

describe('getTempDir / isTempFile', () => {
  it('resolves the directory of the target', () => {
    expect(getTempDir('/tmp/out/file.bin')).toBe(path.resolve('/tmp/out'));
  });

  it('detects justget temp files', () => {
    expect(isTempFile('.justget-a-abc12-primary-0.txt')).toBe(true);
    expect(isTempFile('a.txt')).toBe(false);
    expect(isTempFile('/tmp/.justget-a-abc12-primary-0.txt')).toBe(true);
  });
});

describe('getOriginalFromTemp / getHashFromTemp', () => {
  it('round-trips the chunk format', () => {
    const temp = getTempFileName('/x/archive.tar.gz', 'primary', 2);
    expect(getOriginalFromTemp(temp)).toBe('archive.tar.gz');
    expect(getHashFromTemp(temp)).toBe(generateShortHash('/x/archive.tar.gz'));
  });

  it('parses the merged format', () => {
    const merged = getMergedTempFileName('/x/data.bin');
    expect(getOriginalFromTemp(merged)).toBe('data.bin');
    expect(getHashFromTemp(merged)).toBe(generateShortHash('/x/data.bin'));
  });

  it('returns the basename when the format is unknown', () => {
    expect(getOriginalFromTemp('not-a-temp-file.txt')).toBe('not-a-temp-file.txt');
    expect(getHashFromTemp('not-a-temp-file.txt')).toBeNull();
  });
});
