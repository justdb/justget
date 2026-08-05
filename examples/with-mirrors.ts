/**
 * Example: Download with multiple mirrors
 */

import { download } from 'justget';

async function mirrorExample() {
  await download({
    url: 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
    output: './node.tar.xz',
    mirrors: [
      'https://npmmirror.com/mirrors/node/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
      'https://cdn.npmmirror.com/dist/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
      'https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
    ],
    options: {
      primaryWarmupTime: 5000,        // 5 seconds warmup
      speedThreshold: 500 * 1024,     // 500 KB/s threshold
      sizeThreshold: 50 * 1024 * 1024, // 50 MB threshold
      chunks: 4,                      // Use 4 chunks
      retries: 3,                     // Retry 3 times
      onProgress: (progress) => {
        console.log(`Progress: ${progress.percentage.toFixed(1)}%`);
        console.log(`Sources:`);
        for (const source of progress.sources) {
          console.log(`  ${source.id}: ${formatSpeed(source.speed)}/s (${source.status})`);
        }
        console.log();
      },
    },
  });
}

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

mirrorExample().catch(console.error);