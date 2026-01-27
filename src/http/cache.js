const crypto = require("crypto");

/**
 * HTTP 缓存管理器
 * 提供 ETag 生成、条件请求验证等功能
 */
class CacheManager {
  constructor() {
    this.etags = new Map(); // 存储 ETag 缓存
    this.lastModified = new Map(); // 存储最后修改时间
  }

  /**
   * 生成 ETag（基于数据内容的 MD5 哈希）
   * @param {any} data - 要生成 ETag 的数据
   * @returns {string} ETag 字符串
   */
  generateETag(data) {
    const content = typeof data === "string" ? data : JSON.stringify(data);
    const hash = crypto.createHash("md5").update(content).digest("hex");
    return `"${hash}"`;
  }

  /**
   * 生成弱 ETag（用于可能有微小差异的内容）
   * @param {any} data - 要生成 ETag 的数据
   * @returns {string} 弱 ETag 字符串
   */
  generateWeakETag(data) {
    const content = typeof data === "string" ? data : JSON.stringify(data);
    const hash = crypto.createHash("md5").update(content).digest("hex").substring(0, 16);
    return `W/"${hash}"`;
  }

  /**
   * 检查是否应该返回 304 Not Modified
   * @param {object} req - HTTP 请求对象
   * @param {string} etag - 当前资源的 ETag
   * @param {string|Date} lastModified - 最后修改时间
   * @returns {boolean} 是否应该返回 304
   */
  shouldReturn304(req, etag, lastModified) {
    // 检查 If-None-Match (ETag 验证)
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch) {
      // 支持多个 ETag（用逗号分隔）
      const etags = ifNoneMatch.split(",").map((e) => e.trim());
      if (etags.includes(etag) || etags.includes("*")) {
        return true;
      }
    }

    // 检查 If-Modified-Since (时间验证)
    const ifModifiedSince = req.headers["if-modified-since"];
    if (ifModifiedSince && lastModified) {
      try {
        const reqTime = new Date(ifModifiedSince).getTime();
        const modTime = lastModified instanceof Date ? lastModified.getTime() : new Date(lastModified).getTime();
        if (reqTime >= modTime) {
          return true;
        }
      } catch {
        // 日期解析失败，忽略
      }
    }

    return false;
  }

  /**
   * 设置缓存相关的 HTTP 头
   * @param {object} res - HTTP 响应对象
   * @param {object} options - 缓存选项
   */
  setCacheHeaders(res, options = {}) {
    const {
      maxAge = 300, // 默认5分钟
      sMaxAge = null, // 共享缓存（CDN）的 max-age
      etag = null,
      lastModified = null,
      mustRevalidate = false,
      immutable = false,
      noCache = false,
      noStore = false,
      isPublic = true,
    } = options;

    // 构建 Cache-Control 头
    const cacheControlParts = [];

    if (noStore) {
      cacheControlParts.push("no-store");
    } else if (noCache) {
      cacheControlParts.push("no-cache");
    } else {
      cacheControlParts.push(isPublic ? "public" : "private");
      cacheControlParts.push(`max-age=${maxAge}`);
      if (sMaxAge !== null) {
        cacheControlParts.push(`s-maxage=${sMaxAge}`);
      }
      if (mustRevalidate) {
        cacheControlParts.push("must-revalidate");
      }
      if (immutable) {
        cacheControlParts.push("immutable");
      }
    }

    res.setHeader("Cache-Control", cacheControlParts.join(", "));

    // 设置 ETag
    if (etag) {
      res.setHeader("ETag", etag);
    }

    // 设置 Last-Modified
    if (lastModified) {
      const dateStr = lastModified instanceof Date ? lastModified.toUTCString() : new Date(lastModified).toUTCString();
      res.setHeader("Last-Modified", dateStr);
    }

    // 设置 Vary 头（用于内容协商）
    res.setHeader("Vary", "Accept-Encoding");
  }

  /**
   * 为 API 响应设置缓存
   * @param {object} res - HTTP 响应对象
   * @param {any} data - 响应数据
   * @param {object} options - 缓存选项
   */
  setApiCache(res, data, options = {}) {
    const etag = this.generateETag(data);
    const lastModified = new Date();

    this.setCacheHeaders(res, {
      maxAge: 300, // 默认5分钟
      etag,
      lastModified,
      ...options,
    });

    return { etag, lastModified };
  }

  /**
   * 清理过期的缓存条目
   */
  cleanup() {
    // 简单实现：清空所有缓存
    this.etags.clear();
    this.lastModified.clear();
  }
}

// 导出单例
const cacheManager = new CacheManager();

module.exports = { CacheManager, cacheManager };
