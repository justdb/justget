/**
 * 进程退出回归测试 / process-exit regression test
 *
 * 回归场景：probe() 的 HEAD 成功路径若不销毁响应体，keep-alive socket 会
 * 悬挂事件循环，导致使用该库的脚本在下载后进程不退出（曾被 vitest 强制
 * 退出掩盖）。此处用真实子进程验证 probe 后自然退出。
 *
 * 完整 download 的自然退出验证在 tests/integration/process-exit.mjs
 * （vitest worker 环境会干扰 keep-alive socket 释放时机，独立脚本更真实）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createTestServer, makeContent } from './helpers.js';
import type { TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const root = path.resolve(__dirname, '../..');
const distBuilt = fs.existsSync(path.join(root, 'dist/index.js')) && fs.existsSync(path.join(root, 'dist/core/http.js'));

/** 运行子进程并等待退出（异步，不阻塞父进程事件循环） */
function runChild(args: string[], timeoutMs: number): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ status: null, stdout, stderr }); // 挂住 = status null
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
  });
}

describe.skipIf(!distBuilt)('process exit after download', () => {
  it('child process exits naturally after probe() (HEAD body released)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justget-exit-'));
    const script = path.join(dir, 'probe.mjs');
    fs.writeFileSync(
      script,
      `
import { probe } from ${JSON.stringify('file://' + path.join(root, 'dist/core/http.js'))};
const r = await probe(process.argv[2]);
console.log('PROBE_DONE', r.supportsRange);
`
    );
    const s = await createTestServer({ content: makeContent(64 * 1024), supportRange: true });
    servers.push(s);
    const res = await runChild([script, s.baseUrl + '/x.bin'], 10000);
    expect(res.status).toBe(0); // 自然退出（10s 内），否则为 null
    expect(res.stdout).toContain('PROBE_DONE true');
    expect(res.stderr).toBe('');
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000);
});
