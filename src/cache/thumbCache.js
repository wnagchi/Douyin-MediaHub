const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

/**
 * 缩略图缓存管理器
 * 负责缩略图的清理、统计和维护
 */
class ThumbCacheManager {
  constructor({ rootDir, maxSizeGB = 5, maxAgeMs = 30 * 24 * 60 * 60 * 1000 }) {
    this.rootDir = rootDir;
    this.maxSize = maxSizeGB * 1024 * 1024 * 1024; // 转换为字节
    this.maxAge = maxAgeMs; // 最大保留时间（毫秒）
    this.thumbsDir = path.join(rootDir, "data", "thumbs");
    this.vthumbsDir = path.join(rootDir, "data", "vthumbs");
  }

  /**
   * 获取缓存统计信息
   * @returns {Promise<object>} 统计信息
   */
  async getStats() {
    const stats = {
      thumbs: await this.getDirStats(this.thumbsDir),
      vthumbs: await this.getDirStats(this.vthumbsDir),
      total: 0,
      totalCount: 0,
    };

    stats.total = stats.thumbs.size + stats.vthumbs.size;
    stats.totalCount = stats.thumbs.count + stats.vthumbs.count;

    return stats;
  }

  /**
   * 获取目录统计信息
   * @param {string} dirPath - 目录路径
   * @returns {Promise<object>} 目录统计
   */
  async getDirStats(dirPath) {
    try {
      await fsp.access(dirPath);
    } catch {
      return { count: 0, size: 0, path: dirPath };
    }

    try {
      const files = await fsp.readdir(dirPath);
      let totalSize = 0;
      let count = 0;
      let oldestAccess = Date.now();
      let newestAccess = 0;

      for (const file of files) {
        try {
          const filePath = path.join(dirPath, file);
          const stat = await fsp.stat(filePath);
          totalSize += stat.size;
          count++;

          const atime = stat.atimeMs;
          if (atime < oldestAccess) oldestAccess = atime;
          if (atime > newestAccess) newestAccess = atime;
        } catch {
          // 忽略无法访问的文件
        }
      }

      return {
        count,
        size: totalSize,
        path: dirPath,
        oldestAccess: count > 0 ? new Date(oldestAccess) : null,
        newestAccess: count > 0 ? new Date(newestAccess) : null,
      };
    } catch (err) {
      return { count: 0, size: 0, path: dirPath, error: String(err.message) };
    }
  }

  /**
   * 清理缓存
   * @param {object} options - 清理选项
   * @returns {Promise<object>} 清理结果
   */
  async cleanup(options = {}) {
    const { force = false, maxAge = this.maxAge, maxSize = this.maxSize } = options;

    const results = {
      thumbs: await this.cleanupDir(this.thumbsDir, { force, maxAge, maxSize: maxSize / 2 }),
      vthumbs: await this.cleanupDir(this.vthumbsDir, { force, maxAge, maxSize: maxSize / 2 }),
    };

    results.total = {
      deleted: results.thumbs.deleted + results.vthumbs.deleted,
      freedSize: results.thumbs.freedSize + results.vthumbs.freedSize,
    };

    return results;
  }

  /**
   * 清理指定目录
   * @param {string} dirPath - 目录路径
   * @param {object} options - 清理选项
   * @returns {Promise<object>} 清理结果
   */
  async cleanupDir(dirPath, options = {}) {
    const { force = false, maxAge = this.maxAge, maxSize = this.maxSize } = options;

    try {
      await fsp.access(dirPath);
    } catch {
      return { deleted: 0, freedSize: 0, error: "Directory not found" };
    }

    try {
      const files = await fsp.readdir(dirPath);
      const now = Date.now();
      const fileStats = [];

      // 收集文件信息
      for (const file of files) {
        try {
          const filePath = path.join(dirPath, file);
          const stat = await fsp.stat(filePath);
          fileStats.push({
            path: filePath,
            name: file,
            size: stat.size,
            atime: stat.atimeMs,
            mtime: stat.mtimeMs,
            age: now - stat.atimeMs,
          });
        } catch {
          // 忽略无法访问的文件
        }
      }

      let deleted = 0;
      let freedSize = 0;

      // 1. 强制清理：删除所有文件
      if (force) {
        for (const file of fileStats) {
          try {
            await fsp.unlink(file.path);
            deleted++;
            freedSize += file.size;
          } catch {
            // 忽略删除失败
          }
        }
        return { deleted, freedSize };
      }

      // 2. 删除过期文件（基于访问时间）
      const expiredFiles = fileStats.filter((f) => f.age > maxAge);
      for (const file of expiredFiles) {
        try {
          await fsp.unlink(file.path);
          deleted++;
          freedSize += file.size;
        } catch {
          // 忽略删除失败
        }
      }

      // 3. 如果超过大小限制，删除最旧的文件（LRU）
      const remainingFiles = fileStats.filter((f) => f.age <= maxAge);
      const totalSize = remainingFiles.reduce((sum, f) => sum + f.size, 0);

      if (totalSize > maxSize) {
        // 按访问时间排序（最旧的在前）
        const sorted = remainingFiles.sort((a, b) => a.atime - b.atime);
        let currentSize = totalSize;
        const targetSize = maxSize * 0.8; // 清理到80%

        for (const file of sorted) {
          if (currentSize <= targetSize) break;
          try {
            await fsp.unlink(file.path);
            currentSize -= file.size;
            deleted++;
            freedSize += file.size;
          } catch {
            // 忽略删除失败
          }
        }
      }

      return { deleted, freedSize };
    } catch (err) {
      return { deleted: 0, freedSize: 0, error: String(err.message) };
    }
  }

  /**
   * 清空所有缓存
   * @returns {Promise<object>} 清理结果
   */
  async clearAll() {
    return this.cleanup({ force: true });
  }

  /**
   * 格式化字节大小
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的大小
   */
  static formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }
}

module.exports = { ThumbCacheManager };
