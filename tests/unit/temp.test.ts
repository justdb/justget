/**
 * 临时文件生命周期单元测试 / temp file lifecycle unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  cleanupOldTempFiles,
  buildChunkTempPaths,
  findResumableMerged,
  mergeChunks,
  commitMerged,
  removeAllTempFiles,
} from '../../src/core/temp.js';
import { getTempFileName, getMergedTempFileName, generateShortHash } from '../../src/utils/hash.js';

let dir: string;
let output: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justget-temp-'));
  output = path.join(dir, 'out.bin');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('buildChunkTempPaths', () => {
  it('creates N paths inside the output directory', () => {
    const paths = buildChunkTempPaths(output, 4);
    expect(paths).toHaveLength(4);
    for (const p of paths) {
      expect(path.dirname(p.tempPath)).toBe(dir);
      expect(fs.existsSync(p.tempPath)).toBe(false);
    }
  });
});

describe('mergeChunks', () => {
  it('merges chunks in index order even if given out of order', async () => {
    const chunks = [
      { index: 2, data: Buffer.from('ccc') },
      { index: 0, data: Buffer.from('aaa') },
      { index: 1, data: Buffer.from('bbb') },
    ];
    const merged = path.join(dir, 'merged.bin');
    for (const c of chunks) {
      fs.writeFileSync(path.join(dir, `chunk-${c.index}`), c.data);
    }
    await mergeChunks(
      chunks.map((c) => ({ index: c.index, tempPath: path.join(dir, `chunk-${c.index}`) })),
      merged
    );
    expect(fs.readFileSync(merged).toString()).toBe('aaabbbccc');
  });

  it('throws when a chunk file is missing', async () => {
    const merged = path.join(dir, 'merged.bin');
    await expect(
      mergeChunks([{ index: 0, tempPath: path.join(dir, 'nope') }], merged)
    ).rejects.toThrow();
  });
});

describe('commitMerged', () => {
  it('atomically renames to the output path', () => {
    const merged = path.join(dir, 'merged.bin');
    fs.writeFileSync(merged, 'final');
    commitMerged(merged, output);
    expect(fs.readFileSync(output).toString()).toBe('final');
    expect(fs.existsSync(merged)).toBe(false);
  });
});

describe('findResumableMerged', () => {
  it('finds a merged temp file meeting the size threshold', () => {
    const merged = path.join(dir, getMergedTempFileName(output));
    fs.writeFileSync(merged, Buffer.alloc(95)); // 95% of 100
    expect(findResumableMerged(output, 100)).toBe(merged);
  });

  it('returns null when below the 90% threshold', () => {
    const merged = path.join(dir, getMergedTempFileName(output));
    fs.writeFileSync(merged, Buffer.alloc(80));
    expect(findResumableMerged(output, 100)).toBeNull();
  });

  it('returns null when no merged file exists', () => {
    expect(findResumableMerged(output, 100)).toBeNull();
  });
});

describe('removeAllTempFiles', () => {
  it('removes only files related to the output', () => {
    const hash = generateShortHash(output);
    const related = [
      path.join(dir, getTempFileName(output, 'primary', 0)),
      path.join(dir, getTempFileName(output, 'mirror-1', 2)),
      path.join(dir, getMergedTempFileName(output)),
    ];
    const unrelated = [path.join(dir, 'keep.txt'), path.join(dir, `.justget-other-${generateShortHash('other-path')}-x-0.bin`)];
    for (const f of [...related, ...unrelated]) fs.writeFileSync(f, 'x');

    removeAllTempFiles(output);

    for (const f of related) expect(fs.existsSync(f)).toBe(false);
    expect(fs.existsSync(unrelated[0])).toBe(true);
    // 不同 hash 的 justget 临时文件应保留 / different-hash temp files stay
    expect(fs.existsSync(unrelated[1])).toBe(true);
  });
});

describe('cleanupOldTempFiles', () => {
  it('deletes stale temp files (>1h) and keeps fresh ones', () => {
    const hash = generateShortHash(output);
    const stale = path.join(dir, getTempFileName(output, 'primary', 0));
    const fresh = path.join(dir, getTempFileName(output, 'mirror-0', 1));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    fs.writeFileSync(stale, 'x');
    fs.writeFileSync(fresh, 'x');
    fs.utimesSync(stale, old, old);

    cleanupOldTempFiles(output);

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    // 不同 hash 的临时文件不受影响 / unrelated-hash temp files untouched
    const other = path.join(dir, `.justget-other-${generateShortHash('other-path')}-x-0.bin`);
    fs.writeFileSync(other, 'x');
    fs.utimesSync(other, old, old);
    cleanupOldTempFiles(output);
    expect(fs.existsSync(other)).toBe(true);
  });

  it('does not throw when the directory does not exist', () => {
    expect(() => cleanupOldTempFiles(path.join(dir, 'missing', 'out.bin'))).not.toThrow();
  });
});
