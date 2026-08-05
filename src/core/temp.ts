/**
 * 临时文件生命周期：命名（复用 utils/hash.ts）、清理、合并、原子改名、恢复
 * Temp file lifecycle: naming, cleanup, merging, atomic rename, resume
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { once } from 'node:events';
import {
  generateShortHash,
  getMergedTempFileName,
  getOriginalFromTemp,
  getTempFileName,
  isTempFile,
} from '../utils/hash.js';
import { TEMP_FILE_CONFIG } from '../config.js';

export interface ChunkFile {
  index: number;
  tempPath: string;
}

/**
 * 清理目标文件同目录下超过 maxAgeHours 的旧临时文件
 * Clean stale temp files (older than maxAgeHours) in the target dir
 */
export function cleanupOldTempFiles(targetPath: string): void {
  const dir = path.dirname(path.resolve(targetPath));
  const hash = generateShortHash(targetPath);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isFile() || !isTempFile(entry.name) || !entry.name.includes(hash)) continue;
    try {
      const stat = fs.statSync(path.join(dir, entry.name));
      const ageHours = (now - stat.mtimeMs) / (1000 * 60 * 60);
      if (ageHours > TEMP_FILE_CONFIG.maxAgeHours) {
        fs.unlinkSync(path.join(dir, entry.name));
      }
    } catch {
      // 忽略单个文件失败
    }
  }
}

/**
 * 生成该输出文件的所有临时文件路径
 * Build temp file paths for every chunk of the output
 */
export function buildChunkTempPaths(
  output: string,
  chunkCount: number
): { index: number; tempPath: string }[] {
  const dir = path.dirname(path.resolve(output));
  const paths: { index: number; tempPath: string }[] = [];
  for (let index = 0; index < chunkCount; index++) {
    paths.push({
      index,
      tempPath: path.join(dir, getTempFileName(output, 'chunk', index)),
    });
  }
  return paths;
}

/**
 * 检查是否存在可恢复的 merged 临时文件
 * Check for a resumable merged temp file
 */
export function findResumableMerged(output: string, expectedSize?: number): string | null {
  const merged = path.join(path.dirname(path.resolve(output)), getMergedTempFileName(output));
  try {
    const stat = fs.statSync(merged);
    if (expectedSize !== undefined) {
      if (stat.size < expectedSize * TEMP_FILE_CONFIG.resumeThreshold) return null;
    }
    return merged;
  } catch {
    return null;
  }
}

/**
 * 按 index 顺序合并分块临时文件到 merged 临时文件
 * Merge chunk temp files (ordered by index) into one merged temp file
 *
 * 手动泵数据而非复用 pipeline({end:false})，避免在同一个写流上累积监听器
 * manual pump avoids listener accumulation from repeated pipeline({end:false}) calls
 */
export async function mergeChunks(chunkFiles: ChunkFile[], mergedPath: string): Promise<void> {
  const ordered = [...chunkFiles].sort((a, b) => a.index - b.index);
  const out = fs.createWriteStream(mergedPath, { flags: 'w' });
  let outError: Error | undefined;
  out.on('error', (e) => {
    outError = e;
  });
  try {
    for (const chunk of ordered) {
      const src = fs.createReadStream(chunk.tempPath);
      for await (const data of src) {
        if (outError) throw outError;
        if (!out.write(data)) await once(out, 'drain');
      }
    }
    out.end();
    await once(out, 'finish');
  } finally {
    out.destroy();
  }
}

/**
 * 原子改名：merged 临时文件 → 最终输出文件
 * Atomically move merged temp file to the final output path
 */
export function commitMerged(mergedPath: string, output: string): void {
  fs.renameSync(mergedPath, output);
}

/**
 * 删除该输出文件相关的全部临时文件（chunk + merged）
 * Remove all temp files related to the output (chunks + merged)
 */
export function removeAllTempFiles(output: string): void {
  const dir = path.dirname(path.resolve(output));
  const hash = generateShortHash(output);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !isTempFile(entry.name) || !entry.name.includes(hash)) continue;
    try {
      fs.unlinkSync(path.join(dir, entry.name));
    } catch {
      // 忽略
    }
  }
}

export { getOriginalFromTemp };
