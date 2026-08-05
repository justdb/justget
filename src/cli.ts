#!/usr/bin/env node

/**
 * JustGet CLI
 * 命令行入口（对外接口）
 */

import { program } from 'commander';
import * as path from 'node:path';
import { download } from './index.js';

program
  .name('justget')
  .description('Multi-source racing chunked downloader / 多源竞速分块下载器')
  .version('0.1.0');

program
  .argument('<url>', 'URL to download / 下载地址')
  .option('-o, --output <path>', 'Output file path / 输出文件路径')
  .option('-m, --mirror <url>', 'Mirror URL, repeatable / 镜像地址（可多次指定）', [])
  .option('--warmup <ms>', 'Primary warmup time / 主站预热时间 (ms)', '5000')
  .option('--min-speed <bytes/s>', 'Speed threshold below which mirrors start / 低于此速度启动镜像 (bytes/s)', '512000')
  .option('--fast-primary-threshold <bytes/s>', 'Above this speed, skip mirrors / 主站超过此速度则不启动镜像 (bytes/s)', '2048000')
  .option('--min-size <bytes>', 'File size threshold for mirrors / 启动镜像的最小文件大小 (bytes)', '52428800')
  .option('--min-replace-time <ms>', 'Minimum time before replacing a slow source / 慢源替换最短等待时间 (ms)', '30000')
  .option('--replace-check-interval <ms>', 'Source replacement check interval / 源替换检查间隔 (ms)', '10000')
  .option('--chunks <n>', 'Number of chunks / 分块数量 (auto|n)', 'auto')
  .option('--chunk-size <bytes>', 'Chunk size / 分块大小 (auto|bytes)', 'auto')
  .option('--min-chunk-size <bytes>', 'Minimum chunk size / 最小分块大小 (bytes)', '1048576')
  .option('--retries <n>', 'Retry count per source / 每源重试次数', '3')
  .option('--retry-delay <ms>', 'Retry delay / 重试间隔 (ms)', '2000')
  .option('--timeout <ms>', 'Download timeout / 下载超时 (ms)', '300000')
  .option('--connect-timeout <ms>', 'Connection timeout / 连接超时 (ms)', '10000')
  .option('--checksum <hash>', 'Expected checksum for validation / 预期校验和')
  .option('--checksum-algo <algo>', 'Checksum algorithm / 校验算法 (md5|sha1|sha256|sha512)', 'sha256')
  .action(async (url: string, options: Record<string, any>) => {
    try {
      const mirrors: string[] = Array.isArray(options.mirror) ? options.mirror : [options.mirror].filter(Boolean);

      await download({
        url,
        output: options.output ?? defaultOutputName(url),
        mirrors,
        options: {
          primaryWarmupTime: parseInt(options.warmup),
          speedThreshold: parseInt(options.minSpeed),
          fastPrimaryThreshold: parseInt(options.fastPrimaryThreshold),
          sizeThreshold: parseInt(options.minSize),
          minReplaceTime: parseInt(options.minReplaceTime),
          replaceCheckInterval: parseInt(options.replaceCheckInterval),
          chunks: options.chunks === 'auto' ? 'auto' : parseInt(options.chunks),
          chunkSize: options.chunkSize === 'auto' ? 'auto' : parseInt(options.chunkSize),
          minChunkSize: parseInt(options.minChunkSize),
          retries: parseInt(options.retries),
          retryDelay: parseInt(options.retryDelay),
          timeout: parseInt(options.timeout),
          connectTimeout: parseInt(options.connectTimeout),
          checksum: options.checksum,
          checksumAlgorithm: options.checksumAlgo,
          onProgress: (progress) => {
            const percentage = progress.percentage.toFixed(1);
            const speed = formatSpeed(progress.speed);
            const eta = formatTime(progress.eta);
            process.stdout.write(`\r${percentage}% | ${speed}/s | ETA: ${eta}`);
          },
        },
      });

      process.stdout.write('\n✓ Download complete / 下载完成!\n');
      // Node ≥19 默认 agent keep-alive 会挂住事件循环，主动退出
      // Node >=19 default keep-alive agent keeps the event loop alive; exit explicitly
      process.exit(0);
    } catch (error) {
      console.error('\n✗ Download failed / 下载失败:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();

/**
 * 未指定 -o 时根据 URL 推断默认输出文件名
 * Default output filename derived from the URL when -o is omitted
 */
function defaultOutputName(url: string): string {
  try {
    const basename = path.basename(new URL(url).pathname);
    return basename || 'download.bin';
  } catch {
    return 'download.bin';
  }
}

/**
 * Format speed for display / 格式化速度显示
 */
function formatSpeed(bytesPerSecond: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytesPerSecond;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Format time for display / 格式化时间显示
 */
function formatTime(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}h ${remainingMinutes}m`;
}
