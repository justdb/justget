# JustGet

<div align="center">

**Multi-source racing chunked downloader with intelligent scheduling**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/justget.svg)](https://nodejs.org)

</div>

**English** · [简体中文](./README.md)

---

## ✨ Features

- 🔀 **Multi-source racing** — primary + multiple mirrors download in parallel, automatically pick the fastest source
- 🧩 **Chunked download** — large files split into chunks downloaded in parallel to maximize bandwidth
- 📊 **Intelligent scheduling** — dynamically adjust strategy based on speed and file size
- 🛡️ **Fault tolerance** — a single failed source does not break the whole download
- 🧮 **EWMA speed** — exponentially weighted moving average for stable speed estimation
- ✅ **Checksum validation** — md5 / sha1 / sha256 / sha512

## 📌 Status

| Module | Status |
|---|---|
| Types & config management (defaults / validation / merge) | ✅ Done |
| Chunk strategy (chunk size / ranges) | ✅ Done |
| Speed monitoring (EWMA / instant / average / peak) | ✅ Done |
| Temp-file naming & file validation (checksum) | ✅ Done |
| **Core downloader `download()`** (probe → chunks → warmup → decide → race → replace → merge → verify) | ✅ Done (verified with real downloads) |
| CLI wired to `download()` | ✅ Done |

Verified scenarios:
- Chunked download + merge + temp-file cleanup ✅
- Multi-source parallel racing (mirror startup) ✅
- Primary immediate failure (4xx / connection error) → mirror takes over automatically ✅
- Checksum validation (sha256) ✅
- Resume (existing output / merged temp-file reuse) ✅
- CLI end-to-end ✅

---

## 📦 Install

```bash
npm install justget
# or
yarn add justget
# or
pnpm add justget
```

Requires Node.js ≥ 18.

---

## 🚀 Quick Start

```typescript
import { download } from 'justget';

await download({
  url: 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
  output: './node.tar.xz',
});
```

With mirrors and progress:

```typescript
await download({
  url: 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
  output: './node.tar.xz',
  mirrors: [
    'https://npmmirror.com/mirrors/node/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
    'https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
  ],
  options: {
    onProgress: (p) => {
      console.log(`${p.percentage.toFixed(1)}% | ${(p.speed / 1024).toFixed(0)} KB/s`);
    },
  },
});
```

More examples in [`examples/`](./examples/).

---

## 🖥️ Public API

### 1. `download(options: DownloadOptions): Promise<DownloadResult>`

Main entry point. Resolves with the download result; rejects on failure (including checksum mismatch).

**`DownloadOptions` parameters** (the `options` field is `DownloadConfig`; all optional, all with defaults):

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | Primary URL (required) |
| `output` | `string` | — | Output file path (required) |
| `mirrors` | `string[]` | `[]` | Mirror URLs |
| `options.primaryWarmupTime` | `number` | `5000` | Primary warmup in ms (observe only, no mirrors during this period) |
| `options.speedThreshold` | `number` | `512000` | Speed threshold B/s; below this, consider starting mirrors |
| `options.fastPrimaryThreshold` | `number` | `2048000` | Fast-primary threshold B/s; above this, skip mirrors |
| `options.sizeThreshold` | `number` | `52428800` | File size threshold B; below this, skip mirrors |
| `options.minReplaceTime` | `number` | `30000` | Minimum time before replacing a slow source (ms) |
| `options.replaceCheckInterval` | `number` | `10000` | Source replacement check interval (ms) |
| `options.chunks` | `number \| 'auto'` | `'auto'` | Chunk count |
| `options.chunkSize` | `number \| 'auto'` | `'auto'` | Chunk size in bytes |
| `options.minChunkSize` | `number` | `1048576` | Minimum chunk size in bytes |
| `options.retries` | `number` | `3` | Retry count per source |
| `options.retryDelay` | `number` | `2000` | Retry delay (ms) |
| `options.timeout` | `number` | `300000` | Download timeout (ms) |
| `options.connectTimeout` | `number` | `10000` | Connection timeout (ms) |
| `options.checksum` | `string` | — | Expected checksum (validated after download) |
| `options.checksumAlgorithm` | `'md5'\|'sha1'\|'sha256'\|'sha512'` | `'sha256'` | Checksum algorithm |
| `options.onProgress` | `(p: ProgressInfo) => void` | — | Progress callback |
| `options.onComplete` | `(r: DownloadResult) => void` | — | Completion callback |
| `options.onError` | `(e: Error) => void` | — | Error callback |

### 2. Callbacks & Types

**`ProgressInfo`** (argument of `onProgress`):

```typescript
interface ProgressInfo {
  downloadedBytes: number;   // bytes downloaded
  totalBytes: number;        // total bytes
  percentage: number;        // 0-100
  speed: number;             // current speed B/s
  eta: number;               // estimated time remaining (ms)
  sources: SourceProgress[]; // per-source progress
}
```

**`DownloadResult`** (return value of `download()`):

```typescript
interface DownloadResult {
  path: string;          // output path
  bytes: number;         // total bytes downloaded
  duration: number;      // duration (ms)
  averageSpeed: number;  // average speed B/s
  sources: SourceResult[]; // per-source results
}
```

### 3. Other exports

Besides `download()`, the library also exports common utilities (for advanced use):

- Config: `DEFAULT_CONFIG`, `mergeConfig(user)`
- Chunk strategy: `calculateChunkStrategy`, `calculateChunkSize`, `calculateChunkCount`, `createChunkRanges`
- Speed: `SpeedMonitor`, `EWMA`, `getSpeedStats`
- Utils: `calculateChecksum`, `validateFile`, `getTempFileName`, `generateShortHash`, etc.
- Types: `DownloadOptions`, `DownloadConfig`, `ProgressInfo`, `DownloadResult`, etc.

---

## 🖥️ CLI

```bash
# after global install:
npm install -g justget

justget <url> [options]
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `<url>` | string | — | URL to download (required) |
| `-o, --output <path>` | string | filename from URL | Output path |
| `-m, --mirror <url>` | string[] | — | Mirror URL (repeatable) |
| `--warmup <ms>` | number | `5000` | Primary warmup |
| `--min-speed <bytes/s>` | number | `512000` | Speed threshold; below this, start mirrors |
| `--fast-primary-threshold <bytes/s>` | number | `2048000` | Above this primary speed, skip mirrors |
| `--min-size <bytes>` | number | `52428800` | Below this file size, skip mirrors |
| `--min-replace-time <ms>` | number | `30000` | Min time before replacing a slow source |
| `--replace-check-interval <ms>` | number | `10000` | Replacement check interval |
| `--chunks <n>` | number\|auto | `auto` | Chunk count |
| `--chunk-size <bytes>` | number\|auto | `auto` | Chunk size |
| `--min-chunk-size <bytes>` | number | `1048576` | Min chunk size |
| `--retries <n>` | number | `3` | Retries per source |
| `--retry-delay <ms>` | number | `2000` | Retry delay |
| `--timeout <ms>` | number | `300000` | Download timeout |
| `--connect-timeout <ms>` | number | `10000` | Connection timeout |
| `--checksum <hash>` | string | — | Expected checksum |
| `--checksum-algo <algo>` | string | `sha256` | Checksum algorithm |
| `-V, --version` | — | — | Version |
| `-h, --help` | — | — | Help |

### Examples

```bash
# basic
justget https://example.com/file.zip -o file.zip

# racing with mirrors
justget https://example.com/file.zip -o file.zip \
  --mirror https://mirror1.com/file.zip \
  --mirror https://mirror2.com/file.zip

# small-file fast mode (skip mirrors)
justget https://example.com/file.zip -o file.zip --min-size 0 --fast-primary-threshold 0

# checksum
justget https://example.com/file.zip -o file.zip \
  --checksum a1b2c3... --checksum-algo sha256

# help
justget --help
```

---

## 🧠 How It Works

```
Phase 1 warmup →  Phase 2 decide  →  Phase 3 race   →  Phase 4 optimize →  Phase 5 finish
Primary          Decide whether      Race primary     Replace slow       Merge chunks,
warmup           to start mirrors    + mirrors        sources            verify, clean
(default 5s)                          (every 10s)
```

- **When mirrors start**: primary speed below `speedThreshold`, file larger than `sizeThreshold`, and primary speed below `fastPrimaryThreshold`; on immediate primary failure (4xx/5xx or network error), mirrors start unconditionally and early.
- **Chunk allocation**: the primary source takes chunks from the head of the pool, mirrors from the tail (primary keeps the leading part); merge concatenates by index order.
- **Slow-source replacement**: after `minReplaceTime`, every `replaceCheckInterval` the sources are evaluated; a source consistently below 1/3 of the fastest speed for `slowChecks` consecutive checks is aborted and its unfinished chunks are returned to the pool.
- **No Range support**: primary and mirrors download the whole file concurrently; first to finish wins.
- **Validation**: when `checksum` is set, the merged file is verified.

---

## 🗂️ Temporary Files

Naming: `.justget-{basename}-{hash}-{source}-{chunk}.{ext}`

- Cleaned automatically after completion
- Resume supported after an interrupted download (≥90% complete)

---

## 🛠️ Development

```bash
npm install        # install dependencies (incl. devDependencies)
npm run build      # tsc compile to dist/
npm run dev        # watch mode
npm test           # vitest unit tests
npm run lint       # eslint
npm run format     # prettier
```

## 📄 License

MIT License — © Wind Li

---

*Made with ❤️ by Wind Li*
