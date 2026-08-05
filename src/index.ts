/**
 * JustGet 对外入口
 * Public entry point of JustGet
 */

// 下载器（规划中 / planned）
export { download, Downloader } from './core/downloader.js';

// 配置 Config
export { DEFAULT_CONFIG, mergeConfig, validateConfig, isImmediateFailure } from './config.js';

// 分块策略 Chunk strategy
export {
  calculateChunkStrategy,
  calculateChunkSize,
  calculateChunkCount,
  createChunkRanges,
} from './chunks/strategy.js';

// 速度计算 Speed
export { EWMA, calculateInstantSpeed, calculateAverageSpeed, getSpeedStats } from './speed/ewma.js';
export { SpeedMonitor } from './speed/speed-monitor.js';

// 工具 Utilities
export {
  generateShortHash,
  getTempFileName,
  getMergedTempFileName,
  getTempDir,
  isTempFile,
  getOriginalFromTemp,
  getHashFromTemp,
} from './utils/hash.js';
export { calculateChecksum, validateFile, getFileSize, fileExists } from './utils/validator.js';

// 类型 Types
export type {
  DownloadOptions,
  DownloadConfig,
  ProgressInfo,
  SourceProgress,
  DownloadResult,
  SourceResult,
  SourceStatus,
  ReplaceDecision,
  RangeCheckResult,
  ValidationResult,
  DownloadChunk,
  ChunkStrategy,
  Source,
  SpeedStats,
  SpeedSample,
} from './types.js';
