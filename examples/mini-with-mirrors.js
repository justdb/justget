#!/usr/bin/env node
/**
 * 极简多镜像示例 / Minimal mirror example
 * - options 全部使用默认配置（不传 options）
 * - 不监控进度（无 onProgress 回调）
 * - 只要结果：打印 DownloadResult
 *
 * 真实慢主站场景 / real slow-primary scenario:
 *   主站 go.dev(dl.google.com) 在中国大陆连接超时 → 镜像自动接管
 *   primary go.dev (dl.google.com) times out in CN; mirror takes over
 *
 * 运行 / Run: node examples/mini-with-mirrors.js [url] [output]
 * 需要先构建 / build first: npm run build
 */

import { download } from 'justget';

const url = process.argv[2] ?? 'https://go.dev/dl/go1.21.5.linux-amd64.tar.gz';
const output = process.argv[3] ?? './go1.21.5.tar.gz';

const result = await download({
  url,
  output,
  mirrors: [
    'https://mirrors.aliyun.com/golang/go1.21.5.linux-amd64.tar.gz',
  ],
});

console.log(JSON.stringify(result, null, 2));
