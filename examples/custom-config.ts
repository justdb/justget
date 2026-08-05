/**
 * Example: Custom configuration
 */

import { download } from 'justget';

async function customConfigExample() {
  const result = await download({
    // 真实可下载的文件（npmmirror npm 镜像，~5.7MB）/ real downloadable file
    // sha256: e5335c28f1e86b747bcca820e8445f6f9421bc8ba16a9c3547064ead8fb81c56
    url: 'https://registry.npmmirror.com/typescript/-/typescript-5.3.3.tgz',
    output: './typescript-5.3.3.tgz',
    mirrors: [
      // 替换为真实镜像 URL 才会参与竞速 / replace with real mirror URLs to race
      'https://mirror1.com/typescript-5.3.3.tgz',
      'https://mirror2.com/typescript-5.3.3.tgz',
    ],
    options: {
      // Speed and size thresholds
      primaryWarmupTime: 3000,           // 3 seconds warmup
      speedThreshold: 1024 * 1024,       // 1 MB/s threshold
      sizeThreshold: 100 * 1024 * 1024,  // 100 MB threshold

      // Source replacement
      minReplaceTime: 20000,             // Replace after 20 seconds
      replaceCheckInterval: 5000,        // Check every 5 seconds

      // Chunk configuration
      chunkSize: 10 * 1024 * 1024,       // 10 MB chunks
      minChunkSize: 2 * 1024 * 1024,     // Minimum 2 MB

      // Retry and timeout
      retries: 5,
      retryDelay: 3000,
      timeout: 600000,                   // 10 minutes
      connectTimeout: 15000,             // 15 seconds

      // Validation (real sha256 of the file above) / 校验（上方文件的真实 sha256）
      checksum: 'e5335c28f1e86b747bcca820e8445f6f9421bc8ba16a9c3547064ead8fb81c56',
      checksumAlgorithm: 'sha256',

      // Progress callback
      onProgress: (progress) => {
        const bar = createProgressBar(progress.percentage, 40);
        process.stdout.write(`\r${bar} ${progress.percentage.toFixed(1)}% | ` +
                            `${formatSpeed(progress.speed)}/s | ` +
                            `ETA: ${formatTime(progress.eta)}`);
      },

      // Completion callback
      onComplete: (result) => {
        console.log(`\nDownloaded ${formatBytes(result.bytes)} in ` +
                   `${formatTime(result.duration)} ` +
                   `(avg: ${formatSpeed(result.averageSpeed)}/s)`);
      },
    },
  });
}

function createProgressBar(percentage: number, width: number): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
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

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

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

customConfigExample().catch(console.error);