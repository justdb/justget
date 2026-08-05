/**
 * HTTP 层：源探测与分块流式下载
 * HTTP layer: source probing and range chunk streaming
 */

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import type { Readable } from 'node:stream';
import type { RangeCheckResult } from '../types.js';

/** 下载/探测通用选项 / Common options */
export interface HttpOptions {
  /** 连接（响应头到达）超时 ms / connect timeout */
  connectTimeout?: number;
  /** 整体超时 ms / overall timeout */
  timeout?: number;
  /** 附加请求头 / extra headers */
  headers?: Record<string, string>;
  /** 外部取消信号 / external abort signal */
  signal?: AbortSignal;
}

/** 打开的响应流 / Opened response stream */
export interface OpenedStream {
  status: number;
  /** 响应体长度（206 时为当前块长度）/ body length */
  contentLength?: number;
  /** 完整文件长度（来自 Content-Range total）/ full file length */
  totalLength?: number;
  /** 是否 206 分块响应 / whether server honored Range */
  supportsRange: boolean;
  /** 响应体（Node 流）/ response body (Node stream) */
  body: Readable;
  /** 立即取消 / cancel immediately */
  cancel: () => void;
}

/** HTTP 错误（带状态码，供立即失败判定）/ HTTP error with status code */
export class HttpError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
  }
}

/** 组合多个 AbortSignal（任一触发即取消），兼容 Node 18 / combine signals */
function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/** 解析 Content-Length / parse content length */
function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** 从 Content-Range "bytes 0-0/12345" 解析总长度 / parse total from content-range */
function parseContentRangeTotal(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(value);
  if (!match) return undefined;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 探测一个源：文件大小与 Range 支持
 * Probe a source: file size and Range support.
 * 优先 HEAD；HEAD 拿不到大小时回退 GET Range: bytes=0-0。
 */
export async function probe(
  url: string,
  options: HttpOptions = {}
): Promise<RangeCheckResult> {
  const timeout = options.connectTimeout ?? 10_000;

  // 1) HEAD
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: combineSignals(controller.signal, options.signal),
        headers: options.headers,
      });
      // 4xx/5xx → 源不可用，交由下载阶段处理 / error status → let download phase handle it
      if (res.status >= 400) {
        (res.body as Readable | null)?.destroy();
        return { supportsRange: false };
      }
      const contentLength = parseContentLength(res.headers.get('content-length'));
      const acceptRanges = res.headers.get('accept-ranges') ?? undefined;
      // HEAD 成功且长度已知 → 直接判定
      if (contentLength !== undefined || res.status === 206 || res.status === 200) {
        // 必须销毁响应体，否则 keep-alive socket 悬挂导致进程不退出
        // destroy the body so the keep-alive socket is released (process exit)
        (res.body as Readable | null)?.destroy();
        return {
          supportsRange: acceptRanges === 'bytes' || res.status === 206,
          contentLength,
          acceptRanges,
        };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // 继续回退
  }

  // 2) GET Range: bytes=0-0
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: combineSignals(controller.signal, options.signal),
        headers: { Range: 'bytes=0-0', ...options.headers },
      });
      if (res.status >= 400) {
        (res.body as Readable | null)?.destroy();
        return { supportsRange: false };
      }
      if (res.status === 206) {
        const total = parseContentRangeTotal(res.headers.get('content-range'));
        (res.body as Readable | null)?.destroy();
        return { supportsRange: true, contentLength: total, acceptRanges: 'bytes' };
      }
      const contentLength = parseContentLength(res.headers.get('content-length'));
      (res.body as Readable | null)?.destroy();
      return { supportsRange: false, contentLength, acceptRanges: undefined };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { supportsRange: false };
  }
}

/**
 * 打开一个分块（Range）下载流 / Open a ranged download stream
 *
 * 服务器忽略 Range 时返回 200 全文，由调用方负责跳过 start 字节。
 */
export async function openRangeStream(
  url: string,
  start?: number,
  end?: number,
  options: HttpOptions = {}
): Promise<OpenedStream> {
  const connectTimeout = options.connectTimeout ?? 10_000;
  const overallTimeout = options.timeout ?? 300_000;

  // 连接阶段：connectTimeout 内应收到响应头
  const connectController = new AbortController();
  const connectTimer = setTimeout(() => connectController.abort(), connectTimeout);
  const headers: Record<string, string> = { ...options.headers };
  if (start !== undefined && end !== undefined) headers.Range = `bytes=${start}-${end}`;
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: combineSignals(connectController.signal, options.signal),
      headers,
    });
  } finally {
    clearTimeout(connectTimer);
  }

  // 4xx/5xx → 抛出带状态码的错误 / error status → throw with status code
  if (res.status >= 400) {
    (res.body as Readable | null)?.destroy();
    throw new HttpError(res.status, url);
  }

  // 流阶段：整体超时
  const bodyController = new AbortController();
  const bodyTimer = setTimeout(() => bodyController.abort(), overallTimeout);
  // unref：超时是兜底逻辑，不能挂住进程（否则下载完成后进程 300s 不退出）
  // unref: the timeout is a backstop; a ref'd timer would keep the process
  // alive for overallTimeout ms after the download completes
  bodyTimer.unref?.();
  const combined = combineSignals(bodyController.signal, options.signal);
  const onAbort = () => {
    (res.body as Readable | null)?.destroy();
  };
  combined.addEventListener('abort', onAbort, { once: true });

  const contentRange = res.headers.get('content-range');
  const totalLength = parseContentRangeTotal(contentRange);

  return {
    status: res.status,
    contentLength: parseContentLength(res.headers.get('content-length')),
    totalLength,
    supportsRange: res.status === 206,
    body: res.body as unknown as Readable,
    cancel: () => {
      clearTimeout(bodyTimer);
      (res.body as Readable | null)?.destroy();
    },
  };
}

/** 流式读取响应体，逐块回调（用于写入文件与计数）/ read body chunk by chunk */
export async function consumeBody(
  body: Readable,
  onChunk: (chunk: Buffer) => void | Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  for await (const chunk of body) {
    if (signal?.aborted) throw new Error('Aborted');
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    await onChunk(buffer);
  }
}
