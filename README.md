# JustGet

<div align="center">

**高性能多源竞速分块下载加速器** / **Multi-source racing chunked download accelerator**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/justget.svg)](https://nodejs.org)

</div>

**简体中文** · [English](./README.en.md)

---

## 🎯 为什么需要它 / Why this tool

> 在国内网络环境下，直接访问 GitHub 等国外仓库经常很慢，甚至超时失败。
> 本工具的思路很简单：**主站 + 多个镜像同时下载，谁快用谁**。
> 官方源慢或挂了，会自动切到可用的镜像，不用傻等超时。

```bash
# 示例：GitHub 官方源 + 国内镜像一起抢
justget https://github.com/xxx/releases/download/v1.0/file.zip \
  -o file.zip \
  -m https://gh-proxy.com/https://github.com/xxx/releases/download/v1.0/file.zip \
  -m https://npmmirror.com/mirrors/xxx/file.zip
```

- 官方源快 → 直接用它，不折腾
- 官方源慢/失败 → 自动切镜像，一般几秒内就有结果

---

## ✨ 特性 / Features

- 🔀 **多源竞速** / Multi-source racing — 主站 + 多镜像同时下载，自动选择最快源
- 🧩 **分块下载** / Chunked download — 大文件分块并行，充分利用带宽
- 📊 **智能调度** / Intelligent scheduling — 按速度、文件大小动态调整策略
- 🛡️ **容错机制** / Fault tolerance — 单源失败不影响整体下载
- 🧮 **平滑测速** / EWMA speed — 指数加权移动平均，速度估计更稳定
- ✅ **校验支持** / Checksum validation — md5 / sha1 / sha256 / sha512

## 📌 当前状态 / Status

| 模块 / Module | 状态 / Status |
|---|---|
| 类型定义、配置管理（含默认值/校验/合并） | ✅ 已完成 |
| 分块策略（chunk size / ranges） | ✅ 已完成 |
| 速度监控（EWMA / 瞬时 / 平均 / 峰值） | ✅ 已完成 |
| 临时文件命名、文件校验（checksum） | ✅ 已完成 |
| **核心下载器 `download()`**（探测→分块→预热→决策→竞速→替换→合并→校验） | ✅ 已完成（真实下载验证通过） |
| CLI 接入 `download()` | ✅ 已完成 |

已通过的验证场景 / Verified scenarios:
- 分块下载 + 合并 + 临时文件清理 ✅
- 多源并行竞速（镜像启动） ✅
- 主站立即失败（4xx/连接错误）→ 镜像自动接手 ✅
- checksum 校验（sha256） ✅
- 断点续传（输出已存在 / merged 临时文件复用） ✅
- CLI 端到端 ✅

---

## 📦 安装 / Install

```bash
npm install justget
# 或 / or
yarn add justget
# 或 / or
pnpm add justget
```

需要 Node.js ≥ 18。

---

## 🚀 快速开始 / Quick Start

```typescript
import { download } from 'justget';

await download({
  url: 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-x64.tar.xz',
  output: './node.tar.xz',
});
```

带镜像与进度回调 / With mirrors and progress:

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

完整示例见 / More examples in [`examples/`](./examples/)。

---

## 🖥️ 对外接口 / Public API

### 1. `download(options: DownloadOptions): Promise<DownloadResult>`

核心入口。下载完成后返回结果；失败则抛出异常（含校验失败）。

**`DownloadOptions` 参数 / Parameters**（`options` 字段即 `DownloadConfig`，全部可选，均有默认值）：

| 字段 / Field | 类型 / Type | 默认值 / Default | 说明 / Description |
|---|---|---|---|
| `url` | `string` | — | 主站 URL / Primary URL（必填） |
| `output` | `string` | — | 输出文件路径 / Output file path（必填） |
| `mirrors` | `string[]` | `[]` | 镜像 URL 列表 / Mirror URLs |
| `options.primaryWarmupTime` | `number` | `5000` | 主站预热时间 ms（期间只观察不启动镜像）/ Primary warmup |
| `options.speedThreshold` | `number` | `512000` | 速度阈值 B/s，低于此值考虑启动镜像 / Slow threshold |
| `options.fastPrimaryThreshold` | `number` | `2048000` | 快速主站阈值 B/s，主站高于此值则跳过镜像 / Fast-primary threshold |
| `options.sizeThreshold` | `number` | `52428800` | 文件大小阈值 B，小于此值不启动镜像 / Size threshold |
| `options.minReplaceTime` | `number` | `30000` | 慢源替换最短等待时间 ms / Min time before replacement |
| `options.replaceCheckInterval` | `number` | `10000` | 源替换检查间隔 ms / Replacement check interval |
| `options.chunks` | `number \| 'auto'` | `'auto'` | 分块数量 / Chunk count |
| `options.chunkSize` | `number \| 'auto'` | `'auto'` | 分块大小 B / Chunk size |
| `options.minChunkSize` | `number` | `1048576` | 最小分块大小 B / Min chunk size |
| `options.retries` | `number` | `3` | 每源重试次数 / Retries per source |
| `options.retryDelay` | `number` | `2000` | 重试间隔 ms / Retry delay |
| `options.timeout` | `number` | `300000` | 下载超时 ms / Download timeout |
| `options.connectTimeout` | `number` | `10000` | 连接超时 ms / Connection timeout |
| `options.checksum` | `string` | — | 预期校验和（下载后校验）/ Expected checksum |
| `options.checksumAlgorithm` | `'md5'\|'sha1'\|'sha256'\|'sha512'` | `'sha256'` | 校验算法 / Algorithm |
| `options.onProgress` | `(p: ProgressInfo) => void` | — | 进度回调 / Progress callback |
| `options.onComplete` | `(r: DownloadResult) => void` | — | 完成回调 / Completion callback |
| `options.onError` | `(e: Error) => void` | — | 错误回调 / Error callback |

### 2. 回调与类型 / Callbacks & Types

**`ProgressInfo`**（`onProgress` 入参 / argument）：

```typescript
interface ProgressInfo {
  downloadedBytes: number;   // 已下载字节 / bytes downloaded
  totalBytes: number;        // 总字节 / total bytes
  percentage: number;        // 0-100
  speed: number;             // 当前速度 B/s / current speed
  eta: number;               // 预计剩余 ms / estimated time remaining
  sources: SourceProgress[]; // 各源进度 / per-source progress
}
```

**`DownloadResult`**（`download()` 返回值 / return value）：

```typescript
interface DownloadResult {
  path: string;          // 输出文件路径 / output path
  bytes: number;         // 总下载字节 / total bytes
  duration: number;      // 耗时 ms / duration
  averageSpeed: number;  // 平均速度 B/s / average speed
  sources: SourceResult[]; // 各源结果 / per-source results
}
```

### 3. 其他导出 / Other exports

除 `download()` 外，库还导出常用工具（供高级用法与内部使用 / for advanced use）：

- 配置 / Config: `DEFAULT_CONFIG`、`mergeConfig(user)`
- 分块策略 / Chunk strategy: `calculateChunkStrategy`、`calculateChunkSize`、`calculateChunkCount`、`createChunkRanges`
- 速度 / Speed: `SpeedMonitor`、`EWMA`、`getSpeedStats`
- 工具 / Utils: `calculateChecksum`、`validateFile`、`getTempFileName`、`generateShortHash` 等
- 类型 / Types: `DownloadOptions`、`DownloadConfig`、`ProgressInfo`、`DownloadResult` 等

---

## 🖥️ CLI

```bash
# 全局安装后使用 / after global install:
npm install -g justget

justget <url> [options]
```

### 参数详解 / Options

| 参数 / Option | 类型 / Type | 默认 / Default | 说明 / Description |
|---|---|---|---|
| `<url>` | string | — | 下载地址（必填）/ URL to download |
| `-o, --output <path>` | string | 当前目录文件名 | 输出路径 / Output path |
| `-m, --mirror <url>` | string[] | — | 镜像地址，可多次指定 / Mirror URL (repeatable) |
| `--warmup <ms>` | number | `5000` | 主站预热时间 / Primary warmup |
| `--min-speed <bytes/s>` | number | `512000` | 速度阈值，低于此值启动镜像 / Slow threshold |
| `--fast-primary-threshold <bytes/s>` | number | `2048000` | 主站超过此速度则跳过镜像 / Fast-primary threshold |
| `--min-size <bytes>` | number | `52428800` | 文件小于此大小不启动镜像 / Size threshold |
| `--min-replace-time <ms>` | number | `30000` | 慢源替换最短等待 / Min replace time |
| `--replace-check-interval <ms>` | number | `10000` | 替换检查间隔 / Check interval |
| `--chunks <n>` | number\|auto | `auto` | 分块数量 / Chunk count |
| `--chunk-size <bytes>` | number\|auto | `auto` | 分块大小 / Chunk size |
| `--min-chunk-size <bytes>` | number | `1048576` | 最小分块大小 / Min chunk size |
| `--retries <n>` | number | `3` | 每源重试次数 / Retries |
| `--retry-delay <ms>` | number | `2000` | 重试间隔 / Retry delay |
| `--timeout <ms>` | number | `300000` | 下载超时 / Timeout |
| `--connect-timeout <ms>` | number | `10000` | 连接超时 / Connect timeout |
| `--checksum <hash>` | string | — | 预期校验和 / Expected checksum |
| `--checksum-algo <algo>` | string | `sha256` | 校验算法 / Algorithm |
| `-V, --version` | — | — | 版本号 / Version |
| `-h, --help` | — | — | 帮助 / Help |

### 示例 / Examples

```bash
# 基础下载 / basic
justget https://example.com/file.zip -o file.zip

# 多镜像竞速 / racing with mirrors
justget https://example.com/file.zip -o file.zip \
  --mirror https://mirror1.com/file.zip \
  --mirror https://mirror2.com/file.zip

# 小文件快速下载（跳过镜像）/ small-file fast mode
justget https://example.com/file.zip -o file.zip --min-size 0 --fast-primary-threshold 0

# 校验 / checksum
justget https://example.com/file.zip -o file.zip \
  --checksum a1b2c3... --checksum-algo sha256

# 查看帮助 / help
justget --help
```

---

## 🧠 工作原理 / How It Works

```
阶段1 预热  →  阶段2 决策  →  阶段3 竞速  →  阶段4 优化  →  阶段5 完成
Primary     Decide whether   Race primary   Replace slow    Merge chunks,
warmup      to start         + mirrors      sources         verify, clean
(默认5s)    mirrors                            (每10s)
```

- **启动镜像条件 / When mirrors start**：主站速度低于 `speedThreshold`，且文件大于 `sizeThreshold`，且主站速度低于 `fastPrimaryThreshold`；主站立即失败（4xx/5xx 或网络错误）时无条件提前启动镜像。
- **分块分配 / Chunk allocation**：主源从分块池头部取块、镜像从尾部取块（主源优先持有前段），合并时按 index 顺序拼接。
- **慢源替换 / Slow-source replacement**：下载超过 `minReplaceTime` 后每 `replaceCheckInterval` 评估一次，连续 `slowChecks` 次低于快源 1/3 速度的慢源被中止、其未完成分块交还池子。
- **不支持 Range 时 / No Range support**：主站与镜像整文件同时下载，先完成者胜出。
- **校验 / Validation**：指定 `checksum` 时，合并后校验整个文件。

---

## 🗂️ 临时文件 / Temporary Files

命名格式 / Naming: `.justget-{basename}-{hash}-{source}-{chunk}.{ext}`

- 下载完成后自动清理 / cleaned after completion
- 异常中断可断点续传（>=90% 完整时）/ resume support

---

## 🛠️ 开发 / Development

```bash
npm install        # 安装依赖（含 devDependencies）
npm run build      # tsc 编译到 dist/
npm run dev        # 监听编译
npm test           # vitest 单元测试
npm run lint       # eslint
npm run format     # prettier
```

## 📄 许可证 / License

MIT License — © Wind Li

---

*Made with ❤️ by Wind Li*
