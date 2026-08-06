/**
 * CLI 单元 + E2E 测试（纳入 vitest coverage）
 * CLI unit tests (format helpers) + real child-process E2E
 *
 * 注意：子进程必须用异步 spawn（不能用 spawnSync）——spawnSync 会阻塞
 * 父进程事件循环，导致测试服务器无法响应子进程请求（死锁）。
 * NOTE: use async spawn, NOT spawnSync (spawnSync blocks the event loop,
 * so the in-process test server can't answer the child's requests).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatSpeed, formatTime } from '../../src/cli.js';
import { createTestServer, makeTempDir, makeContent } from './helpers.js';
import type { TestServer } from './helpers.js';

const distCli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

interface SpawnResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** 异步跑 CLI 子进程 / run the CLI in a child process (async) */
function runCli(args: string[], timeoutMs = 30_000): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.VITEST; // 避免 CLI 的 parse 条件跳过 / so the CLI parses
    const child = spawn(process.execPath, [distCli, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

describe('formatSpeed', () => {
  it('formats bytes to human readable units', () => {
    expect(formatSpeed(0)).toBe('0.00 B');
    expect(formatSpeed(512)).toBe('512.00 B');
    expect(formatSpeed(1024)).toBe('1.00 KB');
    expect(formatSpeed(1536)).toBe('1.50 KB');
    expect(formatSpeed(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(formatSpeed(3 * 1024 ** 3)).toBe('3.00 GB');
  });
});

describe('formatTime', () => {
  it('formats milliseconds to s/m/h', () => {
    expect(formatTime(500)).toBe('1s');
    expect(formatTime(59_999)).toBe('1m 0s');
    expect(formatTime(90_000)).toBe('1m 30s');
    expect(formatTime(3_600_000)).toBe('1h 0m');
    expect(formatTime(7_200_000 + 180_000)).toBe('2h 3m');
  });
});

describe('CLI end-to-end (real child process)', () => {
  it('downloads with -o and checksum, exits 0, leaves no temp files', async () => {
    const content = makeContent(192 * 1024, 7);
    const s: TestServer = await createTestServer({ content, supportRange: true });
    try {
      const dir = makeTempDir();
      const output = path.join(dir, 'cli-out.bin');
      const crypto = await import('node:crypto');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const res = await runCli([`${s.baseUrl}/out.bin`, '-o', output, '--checksum', hash, '--chunks', '4', '--min-size', '0']);

      expect(res.status).toBe(0);
      expect(res.signal).toBeNull();
      expect(fs.existsSync(output)).toBe(true);
      expect(fs.readFileSync(output).equals(content)).toBe(true);
      const leftovers = fs.readdirSync(dir).filter((f) => f.startsWith('.justget-'));
      expect(leftovers).toEqual([]);
      fs.rmSync(dir, { recursive: true, force: true });
    } finally {
      await s.close();
    }
  });

  it('shows an error and exits non-zero on missing url', async () => {
    const res = await runCli([], 10_000);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('missing required argument');
  });

  it('derives the default output name from the URL when -o is omitted', async () => {
    const content = makeContent(96 * 1024, 8);
    const s: TestServer = await createTestServer({ content, supportRange: true });
    try {
      const dir = makeTempDir();
      const res = await runCli([`${s.baseUrl}/tool.bin`, '--min-size', '0'], 20_000);
      expect(res.status).toBe(0);
      // CLI 默认输出到 cwd 下的 tool.bin（cwd 是项目根）
      const defaultOut = path.join(process.cwd(), 'tool.bin');
      try {
        expect(fs.existsSync(defaultOut)).toBe(true);
        expect(fs.readFileSync(defaultOut).equals(content)).toBe(true);
      } finally {
        fs.rmSync(defaultOut, { force: true });
      }
    } finally {
      await s.close();
    }
  });
});
