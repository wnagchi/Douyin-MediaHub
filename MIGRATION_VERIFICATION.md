# 扫描目录 SQL 持久化 - 验证清单

## 实现总结

本次实现将扫描目录配置改为 SQL + config.json 双写模式，确保配置持久化并支持首次自动迁移。

### 已完成的修改

#### 1. 后端 - indexer.js
- ✅ 添加 `getConfiguredMediaDirs()` 方法 - 从 meta 表读取 mediaDirs（JSON 格式）
- ✅ 添加 `setConfiguredMediaDirs(paths)` 方法 - 写入 mediaDirs 到 meta 表
- ✅ 包含错误处理和日志记录

#### 2. 后端 - server.js
- ✅ 启动时优先从 SQL 读取目录配置
- ✅ 如果 SQL 为空，走传统 config.json/env 加载路径
- ✅ 首次迁移：将 config.json/env 配置自动写入 SQL
- ✅ 保留默认目录兜底逻辑

#### 3. 后端 - handler.js
- ✅ POST /api/config 改为三步骤双写：
  1. 更新运行态目录（mediaStore.setMediaDirs）
  2. 写入 SQL（indexer.setConfiguredMediaDirs）
  3. 写入 config.json（在非 env 模式下）
- ✅ 返回 `persistedToSql` 字段指示 SQL 写入状态

#### 4. 前端 - api.ts
- ✅ ConfigResponse 接口添加 `persistedToSql?: boolean` 字段

#### 5. 前端 - SetupCard.tsx
- ✅ 更新提示文案："保存后会持久化到数据库并同步写入 config.json"

#### 6. 前端 - SettingsPage.tsx
- ✅ 新增"扫描目录管理"卡片
- ✅ 支持查看当前配置的目录列表
- ✅ 支持编辑和保存目录（每行一个路径）
- ✅ 保存成功后显示 SQL 持久化状态
- ✅ 环境变量模式下禁用编辑并提示

## 验证步骤

### 1. 基础功能验证

#### 测试 1：首次启动（无历史配置）
```bash
# 删除现有配置和数据库（备份后执行）
rm -f config.json
rm -f data/index.sqlite

# 启动服务
npm start
```

**预期结果：**
- 控制台输出：`[config] Migrated X media dir(s) to SQL (first-time)`
- 服务正常启动
- 访问设置页面能看到默认目录

#### 测试 2：SQL 持久化验证
```bash
# 1. 在设置页面配置目录并保存
# 2. 重启服务
npm start
```

**预期结果：**
- 控制台输出：`[config] Loaded X media dir(s) from SQL`
- 目录配置保持不变
- 资源正常扫描和显示

#### 测试 3：config.json 双写验证
```bash
# 保存目录后检查 config.json
cat config.json
```

**预期内容：**
```json
{
  "mediaDirs": [
    "D:\\path\\to\\media1",
    "D:\\path\\to\\media2"
  ],
  "updatedAt": "2025-xx-xxTxx:xx:xx.xxxZ"
}
```

#### 测试 4：环境变量模式
```bash
# 设置环境变量
export MEDIA_DIRS="D:\\media1;D:\\media2"
npm start
```

**预期结果：**
- 环境变量配置生效
- 设置页面显示"由环境变量指定"提示
- 输入框禁用

### 2. API 端点验证

#### GET /api/config
```bash
curl http://localhost:3000/api/config
```

**预期响应：**
```json
{
  "ok": true,
  "mediaDirs": ["D:\\media1", "D:\\media2"],
  "defaultMediaDirs": ["D:\\default"],
  "fromEnv": false
}
```

#### POST /api/config
```bash
curl -X POST http://localhost:3000/api/config \
  -H "Content-Type: application/json" \
  -d '{"mediaDirs": ["D:\\new\\media"]}'
```

**预期响应：**
```json
{
  "ok": true,
  "mediaDirs": ["D:\\new\\media"],
  "defaultMediaDirs": ["D:\\default"],
  "persisted": true,
  "persistedToSql": true
}
```

### 3. 数据库验证

#### 检查 SQL meta 表
```bash
sqlite3 data/index.sqlite "SELECT * FROM meta WHERE key='mediaDirs';"
```

**预期结果：**
```
mediaDirs|["D:\\media1","D:\\media2"]
```

### 4. 回归测试场景

#### 场景 1：删除目录后重建索引
1. 在设置页面删除一个目录
2. 保存配置
3. 点击"同步内容"按钮

**验证点：**
- 已删除目录的资源不再显示
- 索引正确更新

#### 场景 2：添加新目录后扫描
1. 在设置页面添加新目录
2. 保存配置
3. 自动触发后台扫描

**验证点：**
- 新目录的资源被扫描
- 资源统计更新
- 可以按目录筛选

#### 场景 3：迁移场景（从旧版升级）
1. 使用仅有 config.json 的旧版配置
2. 首次启动新版本

**验证点：**
- config.json 配置自动迁移到 SQL
- 控制台显示迁移日志
- 服务正常运行

## 已知注意事项

1. **环境变量优先级**：`MEDIA_DIR(S)` 环境变量会覆盖 SQL/config.json 配置
2. **路径格式**：必须使用绝对路径（如 `D:\path` 或 `/home/user/path`）
3. **重启生效**：SQL 配置在服务重启时加载
4. **双写一致性**：保存时同时写入 SQL 和 config.json（非 env 模式）
5. **容错处理**：SQL 读写失败不会阻断服务启动，会记录警告日志

## 回滚方案

如需回滚到原实现：
1. 删除 indexer 中的 `getConfiguredMediaDirs` 和 `setConfiguredMediaDirs` 方法
2. 恢复 server.js 中的原始启动逻辑
3. 恢复 handler.js 中的原始 /api/config 实现
4. 前端可保持不变（向后兼容）

## 性能影响

- SQL 读取：启动时一次，性能影响可忽略
- SQL 写入：仅在保存配置时，频率极低
- 运行时查询：无影响，仍使用内存中的 mediaStore

## 维护建议

1. 定期备份 `data/index.sqlite`
2. 修改目录配置后建议重启服务
3. 监控日志中的 SQL 读写错误
4. 如遇问题，可删除 SQL 中的 mediaDirs 记录回退到 config.json
