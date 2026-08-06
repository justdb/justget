/**
 * 核心下载器：多源竞速分块下载
 * Core downloader: multi-source racing chunked download
 *
 * 流程 / Flow:
 *  探测(probe) → 分块(chunks) → 主源预热(warmup) → 决策(decide mirrors)
 *  → 竞速(race) → 慢源替换(replace) → 合并(merge) → 校验(verify) → 提交(commit)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWriteStream } from 'node:fs';
import {
  mergeConfig,
  validateConfig,
  isImmediateFailure,
  REPLACEMENT_CONFIG,
} from '../config.js';
import {
  calculateChunkSize,
  calculateChunkCount,
  createChunkRanges,
} from '../chunks/strategy.js';
import { SpeedMonitor } from '../speed/speed-monitor.js';
import { probe, openRangeStream, consumeBody, HttpError } from './http.js';
import {
  cleanupOldTempFiles,
  buildChunkTempPaths,
  findResumableMerged,
  mergeChunks,
  commitMerged,
  removeAllTempFiles,
  removeNonMergedTempFiles,
} from './temp.js';
import { validateFile } from '../utils/validator.js';
import { getTempFileName, getMergedTempFileName } from '../utils/hash.js';
import type {
  DownloadOptions,
  DownloadConfig,
  DownloadResult,
  ProgressInfo,
  SourceProgress,
  SourceResult,
  SourceStatus,
} from '../types.js';

/** 工作源 / a racing worker source */
interface Worker {
  id: string;
  url: string;
  isPrimary: boolean;
  supportsRange: boolean;
  monitor: SpeedMonitor;
  controller: AbortController;
  aborted: boolean;
  slowChecks: number;
  bytesWritten: number;
  startedAt: number;
  status: SourceStatus;
  error?: Error;
}

/** 分块任务 / a chunk task */
interface ChunkTask {
  index: number;
  start: number;
  end: number;
  size: number;
  tempPath: string;
  status: 'pending' | 'assigned' | 'done';
  failures: number;
}

/** 下载共享上下文 / shared download context */
interface Ctx {
  output: string;
  contentLength?: number;
  chunks: ChunkTask[];
  workers: Worker[];
  cfg: DownloadConfig;
  done: boolean;
  lastError?: Error;
  mirrorsStarted: boolean;
  primaryFailedImmediately: boolean;
  /** 单流模式（无 Range）胜者临时文件 / single-stream winner temp file */
  singleWinnerPath?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 多源竞速分块下载
 * Multi-source racing chunked download
 */
export async function download(options: DownloadOptions): Promise<DownloadResult> {
  const startedAt = Date.now();
  const { url, output, mirrors = [] } = options;
  if (!url) throw new Error('url is required / url 必填');
  if (!output) throw new Error('output is required / output 必填');

  const cfg = mergeConfig(options.options);
  validateConfig(cfg);

  const result = await runDownload(url, output, mirrors, cfg);
  const final: DownloadResult = { ...result, duration: Date.now() - startedAt };
  if (cfg.onComplete) cfg.onComplete(final);
  return final;
}

async function runDownload(
  url: string,
  output: string,
  mirrors: string[],
  cfg: DownloadConfig
): Promise<DownloadResult> {
  const startedAt = Date.now();
  const outPath = path.resolve(output);
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });

  // 清理过期临时文件 / clean stale temp files
  cleanupOldTempFiles(outPath);

  // 1) 探测主站 / probe primary
  const primaryProbe = await probe(url, {
    connectTimeout: cfg.connectTimeout,
    timeout: cfg.timeout,
  });
  const contentLength = primaryProbe.contentLength;
  const supportsRange = primaryProbe.supportsRange;

  // 断点续传 / resume: 输出已完整 或 merged 临时文件可复用
  if (contentLength !== undefined) {
    try {
      if (fs.statSync(outPath).size === contentLength) {
        return summarize(outPath, contentLength, [], startedAt, []);
      }
    } catch {
      // 不存在则忽略
    }
    const merged = findResumableMerged(outPath, contentLength);
    if (merged && (await tryResumeMerged(merged, outPath, cfg))) {
      return summarize(outPath, contentLength, [], startedAt, []);
    }
  }

  // 2) 分块规划 / chunk planning
  const chunks: ChunkTask[] = [];
  if (supportsRange && contentLength !== undefined && contentLength > 0) {
    const chunkSize = calculateChunkSize(contentLength, cfg.chunks ?? 'auto', cfg.minChunkSize);
    const count = calculateChunkCount(contentLength, chunkSize);
    const ranges = createChunkRanges(contentLength, count);
    const tempPaths = buildChunkTempPaths(outPath, ranges.length);
    for (let i = 0; i < ranges.length; i++) {
      const [start, end] = ranges[i];
      chunks.push({
        index: i,
        start,
        end,
        size: end - start + 1,
        tempPath: tempPaths[i].tempPath,
        status: 'pending',
        failures: 0,
      });
    }
  }

  const ctx: Ctx = {
    output: outPath,
    contentLength,
    chunks,
    workers: [],
    cfg,
    done: false,
    mirrorsStarted: false,
    primaryFailedImmediately: false,
  };

  const emitProgress = (): void => {
    if (!cfg.onProgress) return;
    const sources: SourceProgress[] = ctx.workers.map((w) => ({
      id: w.id,
      url: w.url,
      downloadedBytes: w.bytesWritten,
      speed: w.monitor.getCurrentSpeed(),
      status: w.status,
    }));
    const downloadedBytes =
      ctx.chunks.length > 0
        ? ctx.chunks.reduce((sum, c) => sum + (c.status === 'done' ? c.size : 0), 0)
        : ctx.workers.reduce((sum, w) => sum + w.bytesWritten, 0);
    const total = ctx.contentLength ?? downloadedBytes;
    const speed = ctx.workers.reduce((sum, w) => sum + w.monitor.getCurrentSpeed(), 0);
    const progress: ProgressInfo = {
      downloadedBytes,
      totalBytes: total,
      percentage: total > 0 ? (downloadedBytes / total) * 100 : 0,
      speed,
      eta: speed > 0 ? ((total - downloadedBytes) / speed) * 1000 : 0,
      sources,
    };
    cfg.onProgress(progress);
  };

  // 3) 镜像启动决策 / mirror-start decision
  const shouldStartMirrors = (): boolean => {
    const primarySpeed = primaryWorker.monitor.getCurrentSpeed();
    const size = ctx.contentLength ?? 0;
    if (primarySpeed >= (cfg.fastPrimaryThreshold ?? 512 * 1024 * 4)) return false;
    if (size < (cfg.sizeThreshold ?? 50 * 1024 * 1024)) return false;
    if (primarySpeed < (cfg.speedThreshold ?? 512 * 1024)) return true;
    const downloaded = ctx.chunks.reduce((s, c) => s + (c.status === 'done' ? c.size : 0), 0);
    if (size > 0 && downloaded / size < 0.3 && primarySpeed < (cfg.speedThreshold ?? 512 * 1024) * 1.5) return true;
    return false;
  };

  const startMirrors = (): void => {
    if (ctx.mirrorsStarted) return;
    ctx.mirrorsStarted = true;
    mirrors.forEach((mirrorUrl, i) => {
      const w: Worker = {
        id: `mirror-${i}`,
        url: mirrorUrl,
        isPrimary: false,
        supportsRange,
        monitor: new SpeedMonitor(),
        controller: new AbortController(),
        aborted: false,
        slowChecks: 0,
        bytesWritten: 0,
        startedAt: Date.now(),
        status: 'active',
      };
      startWorker(w);
    });
  };

  const maybeStartMirrors = (): void => {
    if (ctx.done || ctx.mirrorsStarted || mirrors.length === 0) return;
    // 主源立即失败 → 无条件启动镜像 / immediate primary failure → start mirrors regardless of size
    if (ctx.primaryFailedImmediately) {
      startMirrors();
      return;
    }
    if (shouldStartMirrors()) startMirrors();
  };

  const startWorker = (w: Worker): void => {
    ctx.workers.push(w);
    w.monitor.startSampling(() => w.bytesWritten);
    void runWorker(w, ctx, emitProgress).catch((err) => {
      w.error = err as Error;
      w.status = 'failed';
      ctx.lastError = ctx.lastError ?? (err as Error);
      // 任何 HTTP 4xx/5xx 或网络级失败 → 立即失败，提前启动镜像
      if (
        w.isPrimary &&
        (err instanceof HttpError ||
          isImmediateFailure(err as Error & { status?: number }, (err as { status?: number }).status))
      ) {
        ctx.primaryFailedImmediately = true;
        maybeStartMirrors();
      }
    });
  };

  // 4) 启动主源 / start primary
  const primaryWorker: Worker = {
    id: 'primary',
    url,
    isPrimary: true,
    supportsRange,
    monitor: new SpeedMonitor(),
    controller: new AbortController(),
    aborted: false,
    slowChecks: 0,
    bytesWritten: 0,
    startedAt: Date.now(),
    status: 'active',
  };
  startWorker(primaryWorker);

  // 5) 预热后决策 / decide after warmup
  const warmupTimer = setTimeout(() => maybeStartMirrors(), cfg.primaryWarmupTime ?? 5000);

  // 6) 慢源替换检查 / slow-source replacement
  const replaceCheck = setInterval(() => {
    if (ctx.done) return;
    const active = ctx.workers.filter((w) => w.status === 'active' && !w.aborted);
    if (active.length < 2) return;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < (cfg.minReplaceTime ?? 30_000)) return;
    const fastest = active.reduce((a, b) =>
      a.monitor.getCurrentSpeed() > b.monitor.getCurrentSpeed() ? a : b
    );
    const fastestSpeed = fastest.monitor.getCurrentSpeed();
    if (fastestSpeed <= 0) return;
    for (const w of active) {
      if (w === fastest) continue;
      const ratio = w.monitor.getCurrentSpeed() / fastestSpeed;
      if (ratio < REPLACEMENT_CONFIG.slowThresholdRatio) {
        w.slowChecks += 1;
        if (w.slowChecks >= REPLACEMENT_CONFIG.maxSlowChecks) {
          // 替换：中止慢源，其未完成分块交还池子 / replace: abort slow source, release its chunk
          w.aborted = true;
          w.status = 'failed';
          w.controller.abort();
          emitProgress();
        }
      } else {
        w.slowChecks = 0;
      }
    }
  }, cfg.replaceCheckInterval ?? 10_000);

  // 7) 进度回调 / progress tick
  const progressTimer = setInterval(emitProgress, 1000);

  try {
    // 8) 等待完成 / wait for completion
    await waitForCompletion(ctx, cfg);
    if (!ctx.done) {
      throw ctx.lastError ?? new Error('Download failed: no source could complete / 所有源均失败');
    }

    // 分块模式下 worker 正常退出时不改状态，这里统一标记 / chunked-mode
    // workers exit without updating status; mark them completed here
    for (const w of ctx.workers) {
      if (w.status === 'active') w.status = 'completed';
    }

    // 9) 合并与提交 / merge & commit
    const mergedPath = path.join(dir, getMergedTempFileName(outPath));
    if (ctx.chunks.length > 0) {
      const doneChunks = ctx.chunks
        .filter((c) => c.status === 'done')
        .map((c) => ({ index: c.index, tempPath: c.tempPath }));
      if (doneChunks.length !== ctx.chunks.length) {
        throw new Error(`Incomplete chunks: ${doneChunks.length}/${ctx.chunks.length} / 分块未全部完成`);
      }
      await mergeChunks(doneChunks, mergedPath);
    } else {
      // 单流模式：胜者临时文件即结果 / single-stream: winner temp file is the result
      const winner = ctx.singleWinnerPath;
      if (!winner || !fs.existsSync(winner)) {
        throw new Error('No download produced output / 未产生输出文件');
      }
      fs.renameSync(winner, mergedPath);
    }

    // 10) 校验 / verify checksum
    if (cfg.checksum) {
      const validation = await validateFile(mergedPath, cfg.checksum, cfg.checksumAlgorithm ?? 'sha256');
      if (!validation.valid) {
        throw new Error(
          `Checksum mismatch / 校验和不匹配: expected ${cfg.checksum}, got ${validation.actual ?? 'n/a'}`
        );
      }
    }

    // 11) 原子提交 / atomic commit
    commitMerged(mergedPath, outPath);

    // 12) 清理 / cleanup
    removeAllTempFiles(outPath);

    const finalSize = contentLength ?? fs.statSync(outPath).size;
    return summarize(outPath, finalSize, ctx.workers, startedAt, ctx.chunks);
  } finally {
    clearTimeout(warmupTimer);
    clearInterval(replaceCheck);
    clearInterval(progressTimer);
    for (const w of ctx.workers) {
      w.controller.abort();
      w.monitor.stopSampling(); // 停止测速定时器，防止泄漏 / stop speed-sampling timers (leak fix)
    }
    // 失败时清理分块/单流临时文件，仅保留 merged（供断点续传）
    // On failure: remove chunk/single-stream temp files, keep merged for resume
    if (!ctx.done) removeNonMergedTempFiles(outPath);
  }
}

/** 尝试复用已存在的 merged 临时文件 / try to resume from an existing merged temp file */
async function tryResumeMerged(mergedPath: string, outPath: string, cfg: DownloadConfig): Promise<boolean> {
  try {
    if (cfg.checksum) {
      const validation = await validateFile(mergedPath, cfg.checksum, cfg.checksumAlgorithm ?? 'sha256');
      if (!validation.valid) return false;
    }
    commitMerged(mergedPath, outPath);
    return true;
  } catch {
    return false;
  }
}

/** 等待所有分块完成或全部 worker 失败 / wait until completion or all workers failed */
async function waitForCompletion(ctx: Ctx, cfg: DownloadConfig): Promise<void> {
  const deadline = Date.now() + (cfg.timeout ?? 300_000) * 3;
  while (Date.now() < deadline) {
    if (ctx.done) return;
    const active = ctx.workers.some((w) => w.status === 'active' && !w.aborted);
    if (ctx.chunks.length === 0) {
      // 单流模式：等某个 worker 完成（downloadSingle 会置 ctx.done）
      if (!active && ctx.workers.length > 0) {
        throw ctx.lastError ?? new Error('All sources failed / 所有源均失败');
      }
    } else {
      if (ctx.chunks.every((c) => c.status === 'done')) {
        ctx.done = true;
        return;
      }
      if (!active && ctx.chunks.some((c) => c.status !== 'done')) {
        throw ctx.lastError ?? new Error('No active workers and chunks pending / 无可用源且仍有分块未完成');
      }
    }
    await sleep(100);
  }
  throw new Error(`Download timeout / 下载超时 (${(cfg.timeout ?? 300_000) * 3}ms)`);
}

/** 单个 worker 循环：不断取 chunk 下载 / worker loop: acquire and download chunks */
async function runWorker(w: Worker, ctx: Ctx, emit: () => void): Promise<void> {
  const cfg = ctx.cfg;

  // 单流模式（无 Range）：整文件竞速，先完成者胜出
  if (ctx.chunks.length === 0) {
    await downloadSingle(w, ctx, emit);
    return;
  }

  for (;;) {
    if (w.aborted || ctx.done) return;
    const chunk = acquireChunk(ctx, w);
    if (!chunk) {
      if (ctx.chunks.every((c) => c.status === 'done')) {
        w.status = 'completed';
        return;
      }
      await sleep(150);
      continue;
    }
    chunk.status = 'assigned';

    let succeeded = false;
    for (let attempt = 0; attempt <= (cfg.retries ?? 0) && !w.aborted; attempt++) {
      if (attempt > 0) await sleep(cfg.retryDelay ?? 0);
      try {
        await downloadChunkToFile(w, chunk, ctx);
        succeeded = true;
        break;
      } catch (err) {
        const e = err as Error & { status?: number };
        if (isImmediateFailure(e, e.status)) break; // 立即失败：不再重试该源
        if (attempt === (cfg.retries ?? 0)) w.error = e;
      }
    }

    if (succeeded) {
      chunk.status = 'done';
      w.bytesWritten += chunk.size;
      emit();
    } else {
      // 释放分块交还池子，其他 worker 可接手 / release chunk back to pool
      chunk.status = 'pending';
      chunk.failures += 1;
      if (w.aborted) {
        emit();
        return; // 被替换/中止 / replaced or aborted
      }
      w.status = 'failed';
      w.aborted = true;
      w.controller.abort();
      emit();
      return;
    }
  }
}

/** 从池中取 chunk：主源从头部，镜像从尾部 / acquire chunk: primary head, mirror tail */
function acquireChunk(ctx: Ctx, w: Worker): ChunkTask | undefined {
  if (w.isPrimary) {
    for (const c of ctx.chunks) {
      if (c.status === 'pending') return c;
    }
  } else {
    for (let i = ctx.chunks.length - 1; i >= 0; i--) {
      if (ctx.chunks[i].status === 'pending') return ctx.chunks[i];
    }
  }
  return undefined;
}

/** 下载单个 chunk 到临时文件 / download one chunk to its temp file */
async function downloadChunkToFile(w: Worker, chunk: ChunkTask, ctx: Ctx): Promise<void> {
  const stream = await openRangeStream(w.url, chunk.start, chunk.end, {
    connectTimeout: ctx.cfg.connectTimeout,
    timeout: ctx.cfg.timeout,
    signal: w.controller.signal,
  });

  const ws = createWriteStream(chunk.tempPath, { flags: 'w' });
  let written = 0;
  let skipped = 0;
  const skipBytes = stream.supportsRange ? 0 : chunk.start;

  try {
    await consumeBody(
      stream.body,
      async (value) => {
        if (w.aborted) throw new Error('Aborted');
        let buffer: Buffer;
        if (skipBytes > skipped) {
          // 服务器忽略 Range 返回全文：跳过前置字节 / server ignored Range: skip leading bytes
          const remain = skipBytes - skipped;
          if (value.byteLength <= remain) {
            skipped += value.byteLength;
            return;
          }
          buffer = Buffer.from(value.subarray(remain));
          skipped += remain;
        } else {
          buffer = Buffer.from(value);
        }
        if (buffer.length > 0) {
          if (!ws.write(buffer)) {
            await new Promise<void>((resolve) => ws.once('drain', resolve));
          }
          written += buffer.length;
        }
      },
      w.controller.signal
    );
    ws.end();
    await new Promise<void>((resolve, reject) => {
      ws.once('finish', resolve);
      ws.once('error', reject);
    });
  } catch (err) {
    ws.destroy();
    stream.cancel();
    try {
      fs.unlinkSync(chunk.tempPath);
    } catch {
      // 忽略
    }
    throw err;
  }

  // 校验 chunk 长度 / verify chunk size
  const expected = chunk.end - chunk.start + 1;
  if (written < expected) {
    try {
      fs.unlinkSync(chunk.tempPath);
    } catch {
      // 忽略
    }
    throw new Error(`Chunk ${chunk.index} incomplete: ${written}/${expected} bytes / 分块不完整`);
  }
}

/** 无 Range 模式：整文件下载竞速，先完成者胜出 / no-Range mode: full-file racing */
async function downloadSingle(w: Worker, ctx: Ctx, emit: () => void): Promise<void> {
  const tempPath = path.join(path.dirname(ctx.output), getTempFileName(ctx.output, w.id, 0));
  const stream = await openRangeStream(w.url, undefined, undefined, {
    connectTimeout: ctx.cfg.connectTimeout,
    timeout: ctx.cfg.timeout,
    signal: w.controller.signal,
  });
  const ws = createWriteStream(tempPath, { flags: 'w' });
  let written = 0;
  try {
    await consumeBody(
      stream.body,
      async (value) => {
        if (w.aborted) throw new Error('Aborted');
        const buffer = Buffer.from(value);
        if (!ws.write(buffer)) {
          await new Promise<void>((resolve) => ws.once('drain', resolve));
        }
        written += buffer.length;
      },
      w.controller.signal
    );
    ws.end();
    await new Promise<void>((resolve, reject) => {
      ws.once('finish', resolve);
      ws.once('error', reject);
    });
    w.bytesWritten = written;
    w.status = 'completed';
    if (!ctx.done) {
      // 竞速：最先完成者胜出，其余中止 / first completed worker wins, abort others
      ctx.done = true;
      ctx.singleWinnerPath = tempPath;
      for (const other of ctx.workers) {
        if (other !== w && !other.aborted) {
          other.aborted = true;
          other.status = 'failed';
          other.controller.abort();
        }
      }
    }
    emit();
  } catch (err) {
    ws.destroy();
    stream.cancel();
    throw err;
  }
}

/** 下载器类（download() 的面向对象封装）/ OO wrapper over download() */
export class Downloader {
  private options: DownloadOptions;

  constructor(options: DownloadOptions) {
    this.options = options;
  }

  /** 开始下载 / start download */
  start(): Promise<DownloadResult> {
    return download(this.options);
  }
}

/** 汇总结果 / summarize result */
function summarize(
  outPath: string,
  bytes: number,
  workers: Worker[],
  startedAt: number,
  chunks: ChunkTask[]
): DownloadResult {
  const sources: SourceResult[] = workers.map((w) => ({
    id: w.id,
    url: w.url,
    bytes: w.bytesWritten,
    duration: Date.now() - w.startedAt,
    averageSpeed: (w.bytesWritten / Math.max(1, Date.now() - w.startedAt)) * 1000,
    status: w.status,
  }));
  const totalBytes = chunks.reduce((s, c) => s + (c.status === 'done' ? c.size : 0), 0) || bytes;
  const duration = Date.now() - startedAt;
  return {
    path: outPath,
    bytes: totalBytes,
    duration,
    averageSpeed: duration > 0 ? (totalBytes / duration) * 1000 : 0,
    sources,
  };
}
