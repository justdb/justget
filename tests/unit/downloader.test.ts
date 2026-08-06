/**
 * 下载器集成测试 / downloader integration tests (local HTTP servers)
 *
 * 覆盖：分块下载、单流模式、镜像接管、checksum、断点续传、
 *      竞速、慢源替换、失败清理、Downloader 类。
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { download, Downloader } from '../../src/index.js';
import { createTestServer, makeTempDir, makeContent } from './helpers.js';
import type { TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function listTempFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.startsWith('.justget-'));
}

const SMALL = makeContent(256 * 1024, 1); // 256KB
const MEDIUM = makeContent(1024 * 1024, 2); // 1MB

describe('download: chunked (Range supported)', () => {
  it('downloads, merges, verifies and cleans up', async () => {
    const s = await createTestServer({ content: SMALL, supportRange: true });
    servers.push(s);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    const progressCalls: number[] = [];
    let completed: unknown = null;
    const result = await download({
      url: `${s.baseUrl}/out.bin`,
      output,
      options: {
        chunks: 4,
        minChunkSize: 64 * 1024,
        primaryWarmupTime: 0,
        retries: 0,
        onProgress: (p) => progressCalls.push(p.percentage),
        onComplete: (r) => (completed = r),
      },
    });

    expect(fs.readFileSync(output).equals(SMALL)).toBe(true);
    expect(result.bytes).toBe(SMALL.length);
    expect(result.path).toBe(path.resolve(output));
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(completed).not.toBeNull();
    // 成功后无残留临时文件 / no leftover temp files after success
    expect(listTempFiles(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('races primary and mirror in chunked mode', async () => {
    const primary = await createTestServer({ content: SMALL, supportRange: true });
    const mirror = await createTestServer({ content: SMALL, supportRange: true });
    servers.push(primary, mirror);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    const result = await download({
      url: `${primary.baseUrl}/out.bin`,
      output,
      mirrors: [`${mirror.baseUrl}/out.bin`],
      options: {
        chunks: 4,
        minChunkSize: 64 * 1024,
        primaryWarmupTime: 0,
        retries: 0,
        sizeThreshold: 0, // 允许小文件也启动镜像 / allow mirrors for small files
        speedThreshold: 1024 * 1024 * 1024,
      },
    });

    expect(fs.readFileSync(output).equals(SMALL)).toBe(true);
    expect(result.sources.length).toBeGreaterThanOrEqual(2);
    expect(result.sources.some((src) => src.id === 'mirror-0')).toBe(true);
    expect(result.sources.filter((src) => src.status === 'completed').length).toBeGreaterThanOrEqual(1);
    expect(listTempFiles(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('download: single-stream (no Range)', () => {
  it('downloads the whole file without range requests', async () => {
    const s = await createTestServer({ content: SMALL, supportRange: false });
    servers.push(s);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    const result = await download({
      url: `${s.baseUrl}/out.bin`,
      output,
      options: { primaryWarmupTime: 0, retries: 0 },
    });

    expect(fs.readFileSync(output).equals(SMALL)).toBe(true);
    expect(result.bytes).toBe(SMALL.length);
    expect(listTempFiles(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('single-stream racing: winner wins, others aborted', async () => {
    const a = await createTestServer({ content: SMALL, supportRange: false });
    const b = await createTestServer({ content: SMALL, supportRange: false });
    servers.push(a, b);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    const result = await download({
      url: `${a.baseUrl}/out.bin`,
      output,
      mirrors: [`${b.baseUrl}/out.bin`],
      options: {
        primaryWarmupTime: 0,
        retries: 0,
        sizeThreshold: 0,
        speedThreshold: 1024 * 1024 * 1024,
      },
    });

    expect(fs.readFileSync(output).equals(SMALL)).toBe(true);
    // 竞速结果：至少一个源完成（两个源几乎同时完成时都可能标记 completed，内容一致）
    // racing: at least one completed (both may complete if nearly simultaneous)
    expect(result.sources.filter((src) => src.status === 'completed').length).toBeGreaterThanOrEqual(1);
    expect(listTempFiles(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('download: mirror takeover', () => {
  it('starts mirrors immediately when the primary fails', async () => {
    const bad = await createTestServer({ content: SMALL, fail: true });
    const mirror = await createTestServer({ content: SMALL, supportRange: true });
    servers.push(bad, mirror);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    const result = await download({
      url: `${bad.baseUrl}/out.bin`,
      output,
      mirrors: [`${mirror.baseUrl}/out.bin`],
      options: { primaryWarmupTime: 5000, retries: 0 }, // 预热长也无关：立即失败提前启动 / warmup irrelevant: immediate failure
    });

    expect(fs.readFileSync(output).equals(SMALL)).toBe(true);
    const primary = result.sources.find((src) => src.id === 'primary');
    const m = result.sources.find((src) => src.id === 'mirror-0');
    expect(primary?.status).toBe('failed');
    expect(m?.status).toBe('completed');
    expect(listTempFiles(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects when every source fails', async () => {
    const bad1 = await createTestServer({ content: SMALL, fail: true });
    const bad2 = await createTestServer({ content: SMALL, fail: true });
    servers.push(bad1, bad2);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    await expect(
      download({
        url: `${bad1.baseUrl}/out.bin`,
        output,
        mirrors: [`${bad2.baseUrl}/out.bin`],
        options: { primaryWarmupTime: 0, retries: 0 },
      })
    ).rejects.toThrow();
    expect(fs.existsSync(output)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('download: checksum', () => {
  it('passes when the checksum matches', async () => {
    const s = await createTestServer({ content: SMALL, supportRange: true });
    servers.push(s);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    await download({
      url: `${s.baseUrl}/out.bin`,
      output,
      options: {
        chunks: 4,
        minChunkSize: 64 * 1024,
        primaryWarmupTime: 0,
        retries: 0,
        checksum: sha256(SMALL),
        checksumAlgorithm: 'sha256',
      },
    });
    expect(fs.existsSync(output)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects and keeps no output on mismatch', async () => {
    const s = await createTestServer({ content: SMALL, supportRange: true });
    servers.push(s);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    await expect(
      download({
        url: `${s.baseUrl}/out.bin`,
        output,
        options: {
          primaryWarmupTime: 0,
          retries: 0,
          checksum: '0'.repeat(64),
        },
      })
    ).rejects.toThrow(/Checksum mismatch/);
    expect(fs.existsSync(output)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('download: resume', () => {
  it('skips re-download when the output already has the right size', async () => {
    const s = await createTestServer({ content: SMALL, supportRange: true });
    servers.push(s);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    await download({
      url: `${s.baseUrl}/out.bin`,
      output,
      options: { primaryWarmupTime: 0, retries: 0 },
    });
    const afterFirst = s.requests.length;
    expect(afterFirst).toBeGreaterThan(1);

    const t0 = Date.now();
    const result = await download({
      url: `${s.baseUrl}/out.bin`,
      output,
      options: { primaryWarmupTime: 0, retries: 0 },
    });
    // 第二次只发探测请求（HEAD），不再下载 / second run only probes (HEAD)
    expect(s.requests.length - afterFirst).toBe(1);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(result.bytes).toBe(SMALL.length);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('download: slow-source replacement', () => {
  it('aborts the slow primary and lets the mirror finish', async () => {
    const slowPrimary = await createTestServer({ content: MEDIUM, supportRange: true, throttleMs: 400 });
    const fastMirror = await createTestServer({ content: MEDIUM, supportRange: true, throttleMs: 60 });
    servers.push(slowPrimary, fastMirror);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    const result = await download({
      url: `${slowPrimary.baseUrl}/out.bin`,
      output,
      mirrors: [`${fastMirror.baseUrl}/out.bin`],
      options: {
        chunks: 8,
        minChunkSize: 128 * 1024,
        primaryWarmupTime: 0,
        retries: 0,
        sizeThreshold: 0,
        speedThreshold: 512 * 1024,
        fastPrimaryThreshold: 1024 * 1024 * 1024,
        minReplaceTime: 0,
        replaceCheckInterval: 25,
      },
    });

    expect(fs.readFileSync(output).equals(MEDIUM)).toBe(true);
    expect(result.bytes).toBe(MEDIUM.length);
    const primary = result.sources.find((src) => src.id === 'primary');
    const mirror = result.sources.find((src) => src.id === 'mirror-0');
    // 慢主源被替换（中止），镜像完成 / slow primary replaced (aborted), mirror completed
    expect(primary?.status).toBe('failed');
    expect(mirror?.status).toBe('completed');
    expect(mirror?.bytes).toBeGreaterThan(0);
    expect(listTempFiles(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20000);
});

describe('Downloader class', () => {
  it('wraps download()', async () => {
    const s = await createTestServer({ content: SMALL, supportRange: true });
    servers.push(s);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    const d = new Downloader({
      url: `${s.baseUrl}/out.bin`,
      output,
      options: { primaryWarmupTime: 0, retries: 0 },
    });
    const result = await d.start();
    expect(fs.readFileSync(output).equals(SMALL)).toBe(true);
    expect(result.path).toBe(path.resolve(output));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('download: input validation', () => {
  it('requires url and output', async () => {
    await expect(download({ url: '', output: '/tmp/x' })).rejects.toThrow(/url/);
    await expect(download({ url: 'http://x', output: '' })).rejects.toThrow(/output/);
  });

  it('rejects invalid config', async () => {
    const s = await createTestServer({ content: SMALL, supportRange: true });
    servers.push(s);
    const dir = makeTempDir();
    await expect(
      download({ url: `${s.baseUrl}/x`, output: path.join(dir, 'o'), options: { chunks: 0 } })
    ).rejects.toThrow(/chunks/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('download: failure cleanup (temp files)', () => {
  it('single-stream all-fail leaves no partial temp files', async () => {
    // fail:true → probe 拿不到 content-length → 单流模式；两个源都失败
    const bad1 = await createTestServer({ content: SMALL, fail: true });
    const bad2 = await createTestServer({ content: SMALL, fail: true });
    servers.push(bad1, bad2);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    await expect(
      download({
        url: `${bad1.baseUrl}/out.bin`,
        output,
        mirrors: [`${bad2.baseUrl}/out.bin`],
        options: { primaryWarmupTime: 0, retries: 0 },
      })
    ).rejects.toThrow();
    expect(fs.existsSync(output)).toBe(false);
    // 单流 worker 失败自清理 + finally 兜底：无任何 .justget-* 残留
    expect(listTempFiles(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('chunked: a permanently failing chunk rejects the download', async () => {
    // 前半段 range 全部 500 → 该 chunk 重试耗尽（retries=0）→ 无 active worker → 抛错
    const s = await createTestServer({ content: SMALL, supportRange: true, failRanges: [[0, SMALL.length / 2]] });
    servers.push(s);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    await expect(
      download({
        url: `${s.baseUrl}/out.bin`,
        output,
        options: { primaryWarmupTime: 0, retries: 0 },
      })
    ).rejects.toThrow();
    expect(fs.existsSync(output)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('checksum mismatch keeps the merged temp file for resume', async () => {
    const s = await createTestServer({ content: SMALL, supportRange: true });
    servers.push(s);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    await expect(
      download({
        url: `${s.baseUrl}/out.bin`,
        output,
        options: {
          primaryWarmupTime: 0,
          retries: 0,
          checksum: '0'.repeat(64),
        },
      })
    ).rejects.toThrow(/Checksum mismatch/);
    expect(fs.existsSync(output)).toBe(false);
    // 失败清理保留 merged（供断点续传），chunk 临时文件已清
    const merged = listTempFiles(dir).filter((f) => f.includes('.merged.'));
    expect(merged.length).toBe(1);
    expect(listTempFiles(dir).length).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('single-stream with checksum: passes and commits atomically', async () => {
    const s = await createTestServer({ content: SMALL, supportRange: false });
    servers.push(s);
    const dir = makeTempDir();
    const output = path.join(dir, 'out.bin');

    await download({
      url: `${s.baseUrl}/out.bin`,
      output,
      options: {
        primaryWarmupTime: 0,
        retries: 0,
        checksum: sha256(SMALL),
        checksumAlgorithm: 'sha256',
      },
    });
    expect(fs.existsSync(output)).toBe(true);
    expect(fs.readFileSync(output).equals(SMALL)).toBe(true);
    // 成功后无任何临时文件残留
    expect(listTempFiles(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
