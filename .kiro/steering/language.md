# 交互语言规则

## 语言偏好

**所有与用户的交互必须使用中文（简体中文）。**

## 规则

1. **响应语言**: 所有回复、解释、说明都必须使用中文
2. **代码注释**: 代码中的注释应使用中文（除非是技术术语或 API 文档）
3. **文档**: 生成的文档（如 README、设计文档等）应使用中文
4. **错误消息**: 向用户显示的错误消息应使用中文
5. **日志输出**: 面向用户的日志消息应使用中文

## 例外情况

以下内容可以保持英文：
- 代码变量名、函数名、类名（遵循编程规范）
- 技术术语（如 API、HTTP、IndexedDB 等）
- 第三方库和框架的名称
- Git 提交消息（可选，根据团队规范）
- 代码中的字符串常量（如果是面向系统的）

## 示例

✅ 正确：
```typescript
// 生成缓存键
function generateCacheKey(endpoint: string, params?: Record<string, any>): string {
  // 规范化参数
  const normalized = normalizeParams(params);
  return `${endpoint}:${hash(normalized)}`;
}
```

❌ 错误：
```typescript
// Generate cache key
function generateCacheKey(endpoint: string, params?: Record<string, any>): string {
  // Normalize parameters
  const normalized = normalizeParams(params);
  return `${endpoint}:${hash(normalized)}`;
}
```

## 用户交互

- 始终用中文回答用户的问题
- 用中文解释技术概念
- 用中文描述实现步骤
- 用中文提供建议和反馈
