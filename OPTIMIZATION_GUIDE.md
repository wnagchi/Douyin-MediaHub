# 全量扫描优化指南

本文档说明全量扫描优化的实施细节、验收指标和回滚策略。

## 优化内容

### 阶段1：低风险提速（INDEX_OPT_PHASE1）

**优化项：**
- 按目录事务包裹 DB 写入（减少 fsync 开销）
- orphan 清理从"每目录一次"改为"整轮一次"（减少重复全表扫描）
- 增加复合索引 `media_items(dirId, seenRun)`（加速删除查询）

**预期收益：**
- 全量扫描耗时下降 20-30%
- SQL 写入操作数显著减少
- 删除步骤耗时明显缩短

**回滚：** 设置 `INDEX_OPT_PHASE1=0`

### 阶段2：减少文件级 SQL 往返（INDEX_OPT_PHASE2）

**优化项：**
- 每个目录预加载所有文件旧状态到内存 Map
- 文件扫描循环内改为内存查找，避免逐文件 SQL 查询

**预期收益：**
- SQL 读操作从 O(文件数) 降至 O(目录数)
- 大目录扫描耗时进一步下降 15-25%

**内存影响：**
- 单目录峰值内存增加约 `文件数 × 50 字节`
- 万级文件目录约增加 500KB，百万级约增加 50MB

**回滚：** 设置 `INDEX_OPT_PHASE2=0`

### 阶段3：扫描与生成任务稳态化（INDEX_OPT_PHASE3）

**优化项：**
- 为图片/视频缩略图队列增加上限（默认 5000/3000）
- 超限时拒绝任务，避免内存无限增长
- 暴露队列长度和丢弃统计

**预期收益：**
- 扫描期间进程内存峰值可控
- 避免因缩略图积压导致的 OOM

**回滚：** 设置 `INDEX_OPT_PHASE3=0`

### 阶段4：语义拆分（向后兼容）

**优化项：**
- 将 `force` 拆分为 `forceScan` 和 `rebuildDerived`
- `force=1` 向后兼容映射到两者都开启
- 支持精细控制：仅强制扫描而不重建派生字段

**使用场景：**
- `forceScan=1&rebuildDerived=0`：只强制扫描，不重建 tags/types（适合验证文件变化）
- `forceScan=0&rebuildDerived=1`：只重建派生字段（适合新增字段迁移）
- `force=1`：向后兼容，等同于两者都开启

## 验收指标

### 性能指标

通过 `/api/scan/logs` 查看扫描日志，对比优化前后：

```json
{
  "result": {
    "scannedDirs": 10,
    "added": 50,
    "updated": 20,
    "deleted": 5,
    "durationMs": 15000,
    "metrics": {
      "scannedFiles": 10000,
      "sqlReads": 10,      // 优化后：目录数级别
      "sqlWrites": 1500,   // 优化后：显著减少
      "thumbsQueued": 5000,
      "vthumbsQueued": 2000,
      "thumbQueueLength": 120,   // 队列长度稳定
      "thumbDropped": 0,         // 丢弃数为 0 表示队列充足
      "vthumbQueueLength": 50,
      "vthumbDropped": 0
    }
  }
}
```

**对比基线：**
- `durationMs`：总耗时下降 30%+
- `sqlReads`：从 `scannedFiles` 级别降至 `scannedDirs` 级别
- `sqlWrites`：force 场景下降明显
- 队列长度稳定，无持续增长

### 正确性回归

验证以下接口结果与优化前一致：

1. `/api/resources?page=1&pageSize=30`
2. `/api/authors?page=1&pageSize=20`
3. `/api/tags?limit=100`
4. `/api/stats`

确保：
- 新增/更新/删除统计正确
- 资源列表顺序一致
- 作者和标签聚合无遗漏

## 回滚策略

### 快速回滚

若出现异常，通过环境变量快速回退：

```bash
# 回滚全部优化
INDEX_OPT_PHASE1=0 INDEX_OPT_PHASE2=0 INDEX_OPT_PHASE3=0 npm start

# 仅回滚阶段2（内存可能不足）
INDEX_OPT_PHASE2=0 npm start

# 仅回滚阶段3（缩略图队列异常）
INDEX_OPT_PHASE3=0 npm start
```

### 分阶段启用

建议分批启用，便于定位问题：

```bash
# 第1步：仅启用阶段1（最安全）
INDEX_OPT_PHASE2=0 INDEX_OPT_PHASE3=0 npm start

# 第2步：启用阶段1+2
INDEX_OPT_PHASE3=0 npm start

# 第3步：全部启用（默认）
npm start
```

## 常见问题

### Q1: 扫描后内存占用升高？

A: 阶段2会预加载目录状态到内存。如单目录文件数超百万，可回滚阶段2：

```bash
INDEX_OPT_PHASE2=0 npm start
```

### Q2: 缩略图生成变慢？

A: 阶段3队列背压可能导致部分任务被丢弃。查看 `thumbDropped`/`vthumbDropped` 统计，如持续非零可调大队列上限：

```bash
THUMB_MAX_QUEUE=10000 VTHUMB_MAX_QUEUE=5000 npm start
```

### Q3: force=1 扫描比之前快很多？

A: 阶段4拆分语义后，可以只强制扫描而不重建派生字段：

```bash
# 原 force=1 行为（扫描+重建）
curl -X POST "http://localhost:3000/api/reindex?force=1"

# 新行为：仅强制扫描（更快）
curl -X POST "http://localhost:3000/api/reindex?forceScan=1&rebuildDerived=0"
```

### Q4: 如何验证优化生效？

查看扫描日志的 `metrics` 字段：

- `sqlReads` 应接近 `scannedDirs`（而非 `scannedFiles`）
- `thumbQueueLength` 稳定在阈值内
- 总耗时明显下降

## 监控建议

生产环境建议：

1. 定期检查 `/api/scan/logs` 的 `metrics` 统计
2. 观察 `thumbDropped`/`vthumbDropped`，持续非零需调整队列上限
3. 对比历史扫描耗时，确认优化持续有效
4. 大版本升级后重新验证接口一致性
