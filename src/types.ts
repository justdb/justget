/**
 * Core TypeScript type definitions for GetIt
 */

/**
 * Download configuration options
 */
export interface DownloadOptions {
  /** Primary URL to download from */
  url: string;
  /** Output file path */
  output: string;
  /** Mirror URL list for fallback */
  mirrors?: string[];
  /** Additional configuration */
  options?: DownloadConfig;
}

/**
 * Fine-grained download configuration
 */
export interface DownloadConfig {
  /** Primary server warmup time in milliseconds (default: 5000) */
  primaryWarmupTime?: number;
  /** Speed threshold in bytes/s (default: 512000) */
  speedThreshold?: number;
  /** Fast primary threshold in bytes/s (default: 2048000) - above this, don't start mirrors */
  fastPrimaryThreshold?: number;
  /** File size threshold in bytes (default: 52428800) */
  sizeThreshold?: number;
  /** Minimum time before source replacement in ms (default: 30000) */
  minReplaceTime?: number;
  /** Source replacement check interval in ms (default: 10000) */
  replaceCheckInterval?: number;
  /** Number of chunks or 'auto' (default: 'auto') */
  chunks?: number | 'auto';
  /** Chunk size in bytes or 'auto' (default: 'auto') */
  chunkSize?: number | 'auto';
  /** Minimum chunk size in bytes (default: 1048576) */
  minChunkSize?: number;
  /** Retry count per source (default: 3) */
  retries?: number;
  /** Retry delay in milliseconds (default: 2000) */
  retryDelay?: number;
  /** Download timeout in milliseconds (default: 300000) */
  timeout?: number;
  /** Connection timeout in milliseconds (default: 10000) */
  connectTimeout?: number;
  /** Progress callback */
  onProgress?: (progress: ProgressInfo) => void;
  /** Completion callback */
  onComplete?: (result: DownloadResult) => void;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Expected checksum for validation */
  checksum?: string;
  /** Checksum algorithm */
  checksumAlgorithm?: 'md5' | 'sha1' | 'sha256' | 'sha512';
}

/**
 * Progress information during download
 */
export interface ProgressInfo {
  /** Number of bytes downloaded */
  downloadedBytes: number;
  /** Total number of bytes */
  totalBytes: number;
  /** Completion percentage (0-100) */
  percentage: number;
  /** Current download speed in bytes/s */
  speed: number;
  /** Estimated time remaining in milliseconds */
  eta: number;
  /** Progress for each source */
  sources: SourceProgress[];
}

/**
 * Progress for a single source
 */
export interface SourceProgress {
  /** Source identifier */
  id: string;
  /** Source URL */
  url: string;
  /** Bytes downloaded from this source */
  downloadedBytes: number;
  /** Current speed in bytes/s */
  speed: number;
  /** Source status */
  status: SourceStatus;
}

/**
 * Source status
 */
export type SourceStatus = 'active' | 'waiting' | 'completed' | 'failed';

/**
 * Download result
 */
export interface DownloadResult {
  /** Output file path */
  path: string;
  /** Total bytes downloaded */
  bytes: number;
  /** Total download time in milliseconds */
  duration: number;
  /** Average speed in bytes/s */
  averageSpeed: number;
  /** Sources used */
  sources: SourceResult[];
}

/**
 * Result for a single source
 */
export interface SourceResult {
  /** Source identifier */
  id: string;
  /** Source URL */
  url: string;
  /** Bytes downloaded from this source */
  bytes: number;
  /** Time taken in milliseconds */
  duration: number;
  /** Average speed in bytes/s */
  averageSpeed: number;
  /** Source status */
  status: SourceStatus;
}

/**
 * Download chunk information
 */
export interface DownloadChunk {
  /** Chunk index */
  index: number;
  /** Start byte position */
  start: number;
  /** End byte position */
  end: number;
  /** Size in bytes */
  size: number;
  /** Current download progress */
  progress: number;
  /** Source assigned to this chunk */
  sourceId?: string;
  /** Temporary file path */
  tempPath: string;
}

/**
 * Download source information
 */
export interface Source {
  /** Source identifier */
  id: string;
  /** Source URL */
  url: string;
  /** Whether this is the primary source */
  isPrimary: boolean;
  /** Whether range requests are supported */
  supportsRange: boolean;
  /** Current status */
  status: SourceStatus;
  /** Bytes downloaded */
  downloadedBytes: number;
  /** Current speed in bytes/s */
  speed: number;
  /** Number of consecutive slow checks */
  slowChecks: number;
  /** Start timestamp */
  startTime: number;
}

/**
 * Chunk strategy calculation result
 */
export interface ChunkStrategy {
  /** Primary reserve ratio (0-1) */
  primaryReserve: number;
  /** Mirror start ratio (0-1) */
  mirrorStart: number;
}

/**
 * Slow source replacement decision
 */
export interface ReplaceDecision {
  /** Whether to replace */
  shouldReplace: boolean;
  /** Slow source to replace */
  slowSource?: Source;
  /** Fast source to switch to */
  fastSource?: Source;
  /** Byte position to switch at */
  switchPoint?: number;
}

/**
 * Range support check result
 */
export interface RangeCheckResult {
  /** Whether range requests are supported */
  supportsRange: boolean;
  /** Content length (bytes) */
  contentLength?: number;
  /** Accept-Ranges header value */
  acceptRanges?: string;
}

/**
 * Speed sample for EWMA calculation
 */
export interface SpeedSample {
  /** Bytes */
  bytes: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Speed statistics
 */
export interface SpeedStats {
  /** Current speed in bytes/s */
  current: number;
  /** EWMA speed in bytes/s */
  ewma: number;
  /** Peak speed in bytes/s */
  peak: number;
  /** Average speed in bytes/s */
  average: number;
}

/**
 * File validation result
 */
export interface ValidationResult {
  /** Whether file is valid */
  valid: boolean;
  /** Actual checksum */
  actual?: string;
  /** Expected checksum */
  expected?: string;
  /** Error message */
  error?: string;
}