/**
 * 测试辅助：本地 HTTP 测试服务器
 * Test helper: local HTTP server with Range / failure / throttling support
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServerOptions {
  /** 响应体 / response body */
  content: Buffer;
  /** 是否支持 Range（默认 true）/ support Range requests (default true) */
  supportRange?: boolean;
  /** 全部请求返回 404（模拟主站失败）/ return 404 for every request */
  fail?: boolean;
  /** HEAD 请求直接断连（触发 probe 的 GET Range 回退）/ destroy socket on HEAD */
  rejectHead?: boolean;
  /** 每 16KB 写入间隔 ms（模拟慢源）/ delay per 16KB write (simulate slow source) */
  throttleMs?: number;
  /** 命中这些 [start,end] 区间的 Range 请求返回 500（模拟分块永久失败）/ ranges that return 500 */
  failRanges?: Array<[number, number]>;
}

export interface TestServer {
  baseUrl: string;
  port: number;
  /** 收到的全部请求 / all received requests */
  requests: Array<{ method: string; headers: http.IncomingHttpHeaders }>;
  close(): Promise<void>;
}

/** 创建本地测试服务器 / create a local test server */
export async function createTestServer(opts: TestServerOptions): Promise<TestServer> {
  const requests: TestServer['requests'] = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method ?? '', headers: req.headers });

    const send = (data: Buffer, status: number, headers: Record<string, string | number>) => {
      res.writeHead(status, headers);
      if (opts.throttleMs) {
        const step = 16 * 1024;
        let i = 0;
        const timer = setInterval(() => {
          if (i >= data.length) {
            clearInterval(timer);
            res.end();
            return;
          }
          res.write(data.subarray(i, i + step));
          i += step;
        }, opts.throttleMs);
      } else {
        res.end(data);
      }
    };

    if (opts.fail) {
      send(Buffer.from('Not Found'), 404, { 'Content-Type': 'text/plain' });
      return;
    }

    const content = opts.content;
    const rangeSupport = opts.supportRange !== false;

    if (req.method === 'HEAD' && opts.rejectHead) {
      res.destroy();
      return;
    }

    if (req.method === 'HEAD') {
      const headers: Record<string, string | number> = { 'Content-Length': content.length };
      if (rangeSupport) headers['Accept-Ranges'] = 'bytes';
      send(Buffer.alloc(0), 200, headers);
      return;
    }

    // GET
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (rangeSupport && m) {
      const start = Number.parseInt(m[1], 10);
      const end = m[2] === '' ? content.length - 1 : Math.min(Number.parseInt(m[2], 10), content.length - 1);
      if (start >= content.length || start > end) {
        send(Buffer.alloc(0), 416, { 'Content-Range': `bytes */${content.length}` });
        return;
      }
      // 命中 failRanges → 返回 500（分块永久失败场景）/ fail ranges return 500
      if (opts.failRanges?.some(([rs, re]) => start <= re && end >= rs)) {
        send(Buffer.from('Server Error'), 500, { 'Content-Type': 'text/plain' });
        return;
      }
      send(content.subarray(start, end + 1), 206, {
        'Content-Range': `bytes ${start}-${end}/${content.length}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
      });
      return;
    }

    send(content, 200, { 'Content-Length': content.length });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

/** 创建临时目录（测试输出） / create a temp output dir for tests */
export function makeTempDir(): string {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justget-test-'));
}

/** 生成确定性测试内容 / generate deterministic test content */
export function makeContent(size: number, seed = 42): Buffer {
  const buf = Buffer.alloc(size);
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = x & 0xff;
  }
  return buf;
}
