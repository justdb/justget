/**
 * HTTP 层单元测试 / http layer unit tests (local server)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { probe, openRangeStream, consumeBody, HttpError } from '../../src/core/http.js';
import { createTestServer, makeContent } from './helpers.js';
import type { TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const CONTENT = makeContent(256 * 1024, 1);

describe('probe', () => {
  it('detects Range support via HEAD', async () => {
    const s = await createTestServer({ content: CONTENT, supportRange: true });
    servers.push(s);
    const result = await probe(`${s.baseUrl}/file.bin`);
    expect(result.supportsRange).toBe(true);
    expect(result.contentLength).toBe(CONTENT.length);
    expect(result.acceptRanges).toBe('bytes');
  });

  it('reports no Range support when absent', async () => {
    const s = await createTestServer({ content: CONTENT, supportRange: false });
    servers.push(s);
    const result = await probe(`${s.baseUrl}/file.bin`);
    expect(result.supportsRange).toBe(false);
    expect(result.contentLength).toBe(CONTENT.length);
  });

  it('falls back to GET Range bytes=0-0 when HEAD fails', async () => {
    // HEAD 连接被断开 → probe 回退 GET Range: bytes=0-0 → 206 提供总长
    // HEAD connection dropped → probe falls back to GET Range: bytes=0-0
    const s = await createTestServer({ content: CONTENT, supportRange: true, rejectHead: true });
    servers.push(s);
    const result = await probe(`${s.baseUrl}/file.bin`);
    expect(result.supportsRange).toBe(true);
    expect(result.contentLength).toBe(CONTENT.length);
    expect(result.acceptRanges).toBe('bytes');
    // 验证确实发起了带 Range 的 GET / confirm the ranged GET fallback happened
    expect(s.requests.some((r) => r.method === 'GET' && r.headers.range === 'bytes=0-0')).toBe(true);
  });

  it('returns no Range info on 4xx without throwing', async () => {
    const failed = await createTestServer({ content: CONTENT, fail: true });
    servers.push(failed);
    const result = await probe(`${failed.baseUrl}/file.bin`);
    expect(result.supportsRange).toBe(false);
    expect(result.contentLength).toBeUndefined();
  });
});

describe('openRangeStream', () => {
  it('opens a 206 ranged stream with correct lengths', async () => {
    const s = await createTestServer({ content: CONTENT, supportRange: true });
    servers.push(s);
    const stream = await openRangeStream(`${s.baseUrl}/file.bin`, 0, 1023);
    expect(stream.supportsRange).toBe(true);
    expect(stream.status).toBe(206);
    expect(stream.contentLength).toBe(1024);
    expect(stream.totalLength).toBe(CONTENT.length);
    stream.cancel();
  });

  it('returns 200 full-body when the server ignores Range', async () => {
    const s = await createTestServer({ content: CONTENT, supportRange: false });
    servers.push(s);
    const stream = await openRangeStream(`${s.baseUrl}/file.bin`, 0, 1023);
    expect(stream.supportsRange).toBe(false);
    expect(stream.status).toBe(200);
    stream.cancel();
  });

  it('throws HttpError with status on 4xx/5xx', async () => {
    const s = await createTestServer({ content: CONTENT, fail: true });
    servers.push(s);
    await expect(openRangeStream(`${s.baseUrl}/file.bin`, 0, 10)).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
    });
  });
});

describe('HttpError', () => {
  it('carries the status code', () => {
    const err = new HttpError(503, 'http://x');
    expect(err.status).toBe(503);
    expect(err.message).toContain('503');
  });
});

describe('consumeBody', () => {
  it('reads the full body in order', async () => {
    const s = await createTestServer({ content: CONTENT, supportRange: true });
    servers.push(s);
    const stream = await openRangeStream(`${s.baseUrl}/file.bin`, 0, CONTENT.length - 1);
    const parts: Buffer[] = [];
    await consumeBody(stream.body, (chunk) => {
      parts.push(Buffer.from(chunk));
    });
    stream.cancel();
    expect(Buffer.concat(parts).equals(CONTENT)).toBe(true);
  });

  it('honors an aborted signal', async () => {
    const s = await createTestServer({ content: CONTENT, supportRange: true });
    servers.push(s);
    const stream = await openRangeStream(`${s.baseUrl}/file.bin`, 0, CONTENT.length - 1);
    const controller = new AbortController();
    controller.abort();
    await expect(
      consumeBody(stream.body, async () => {}, controller.signal)
    ).rejects.toThrow();
    stream.cancel();
  });
});
