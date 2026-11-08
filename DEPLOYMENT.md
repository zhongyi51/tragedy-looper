# 私有托管与凭据隔离

本地版使用 Node.js 24、SQLite 和 localhost 会话。托管版使用同一规则引擎、Cloudflare Worker、D1 和 ChatGPT Sites 身份。

## 发布要求

- Sites 访问策略必须是仅所有者。Worker 还会拒绝没有 `oai-authenticated-user-id` 的请求。
- D1 的每条游戏记录按 Sites 用户 ID 隔离；不同账户不能读取对局、剧本或回放。
- `DEEPSEEK_API_KEY` 通过 Sites 环境变量工具以 `is_secret: true` 保存，仅从 Worker 的 `env` 读取。不要写入 `.openai/hosting.json`、客户端、Git 历史或存档。
- `.openai/hosting.json` 配置 `project_id` 和 `"d1": "DB"`；运行 `node scripts/build-worker.mjs` 生成部署构件。GitHub 源码不携带当前私人站点标识，部署时由操作者设置自己的项目。
- `drizzle/0000_initial.sql` 和迁移 journal 随部署包提交；表结构不在请求中动态创建。已经应用的迁移不得修改。

## 并发和费用

D1 条件更新原子检查 revision 并获取每局租约。租约跨 Worker 实例有效；重复提交根据持久化 receipt 返回当前状态。状态、快照与 receipt 在 batch 事务中提交。模型请求前预留预算，异常返回保留预留，不自动重复计费请求。租约为 5 分钟，超过崩溃租约后可以恢复；调用量在终局前隐藏。

## 构建与验证

无第三方构建依赖。构建脚本把规则数据和白名单素材嵌入单个 Worker 模块；部署模块不依赖磁盘或本地 SQLite。

```sh
node scripts/test-all.mjs
node scripts/build-worker.mjs
node --check dist/server/index.js
```

自动测试使用临时 SQLite 模拟 D1 prepare/batch 的 SQL 与事务语义。它验证应用并发和权限逻辑，但不能代替真实 Cloudflare 部署验证。发布后仍需确认平台登录、D1 迁移和真实 API 调用。

## 仓库和备份

仓库只包含代码、规则数据、许可素材、测试和说明。排除 runtime、部署秘密、临时写凭据、模型原始调用记录、本机存档。GitHub 仓库可公开，游戏访问策略独立保持私有。没有提供匿名调用或绕过登录的接口。
