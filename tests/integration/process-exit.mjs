#!/usr/bin/env node
/**
 * 进程自然退出集成测试 / process natural-exit integration test
 *
 * 直接运行（node tests/integration/process-exit.mjs），父进程建本地服务器，
 * 子进程用 dist 产物完成 probe / 完整下载后【不主动退出】，验证进程能在
 * keep-alive socket 释放后自然退出（回归：probe HEAD body 未销毁的 bug）。
 *
 * 说明：不要在 vitest worker 里跑自然退出断言——vitest 环境会干扰
 * keep-alive socket 的释放（内容/显式退出均正常，仅自然退出时机不同）。
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = (p) => `file://${path.join(root, p)}`;

if (!fs.existsSync(path.join(root, 'dist/index.js'))) {
  console.error('dist not built. Run `npm run build` first.');
  process.exit(1);
}

const content = Buffer.alloc(128 * 1024, 5);
const server = http.createServer((req, res) => {
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Length': content.length, 'Accept-Ranges': 'bytes' });
    res.end();
    return;
  }
  const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
  if (m) {
    const s = +m[1], e = +m[2];
    res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${content.length}`, 'Content-Length': e - s + 1 });
    res.end(content.subarray(s, e + 1));
    return;
  }
  res.writeHead(200, { 'Content-Length': content.length });
  res.end(content);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/x.bin`;

/** 运行子进程，观察其是否在 timeout 内自然退出 */
function runChild(scriptBody, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justget-integ-'));
    const script = path.join(dir, 'child.mjs');
    fs.writeFileSync(script, scriptBody);
    const child = spawn('node', [script, ...args], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ status: null, stdout, stderr, scriptDir: dir }); // 挂住
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr, scriptDir: dir });
    });
  });
}

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// 1) probe 后自然退出（回归：HEAD body 未销毁 bug）
{
  const res = await runChild(
    `import { probe } from ${JSON.stringify(dist('dist/core/http.js'))};
     const r = await probe(process.argv[2]);
     console.log('PROBE_DONE', r.supportsRange);`,
    [url],
    10000
  );
  check('probe() 后进程自然退出', res.status === 0 && res.stdout.includes('PROBE_DONE true'), `status=${res.status}`);
}

// 2) 完整 download 后自然退出
{
  const out = path.join(os.tmpdir(), `justget-integ-out-${Date.now()}.bin`);
  const res = await runChild(
    `import { download } from ${JSON.stringify(dist('dist/index.js'))};
     const [u, o] = process.argv.slice(2);
     await download({ url: u, output: o, options: { primaryWarmupTime: 0, retries: 0 } });
     console.log('DOWNLOAD_DONE');
     setTimeout(() => {
       console.log('DUMP5s', process._getActiveHandles().map((h) => h.constructor.name + (h.constructor.name === 'Socket' ? ':unref=' + (typeof h.unref === 'function') : '')).join('|'));
     }, 5000);`,
    [url, out],
    15000
  );
  const okContent = fs.existsSync(out) && fs.readFileSync(out).equals(content);
  check('完整 download 后进程自然退出', res.status === 0 && res.stdout.includes('DOWNLOAD_DONE'), `status=${res.status}`);
  check('下载内容正确', okContent);
  fs.rmSync(res.scriptDir, { recursive: true, force: true });
  fs.rmSync(out, { force: true });
}

server.closeAllConnections?.();
server.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
