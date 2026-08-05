/**
 * Example: Basic download usage
 */

import { download } from 'justget';

async function basicExample() {
  try {
    await download({
      url: 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
      output: './node.tar.xz',
      options: {
        onProgress: (progress) => {
          console.log(
            `${progress.percentage.toFixed(1)}% | ` +
            `${formatSpeed(progress.speed)}/s | ` +
            `ETA: ${formatTime(progress.eta)}`
          );
        },
      },
    });
    console.log('Download complete!');
  } catch (error) {
    console.error('Download failed:', error);
  }
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

function formatTime(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}m ${remainingSeconds}s`;
}

basicExample();