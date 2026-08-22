# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-08-23

### Documentation & UI Polish (文档与界面微调)
- **名称规范化**：全项目与 npm 包元数据统一将 DSH 全称规范为 **DeepSeek Harness**。
- **配置说明优化**：完善 README 中关于禁用内置远程插件的注释说明（防止功能冲突）。
- **设置界面精简**：控制台设置页 GitHub 仓库徽标文字精简为 `dsh-remote-mobile`。

---

## [1.2.0] - 2026-08-22

### Security & Cryptography (安全与加密)
- **Web Crypto 原生 OAEP 与 CSPRNG 增强**：手机登录页在现代浏览器/安全上下文中优先使用原生 `window.crypto.subtle.encrypt({ name: 'RSA-OAEP' })` 进行 2048 位 RSA 加密；回退纯 JS 垫片中使用 `crypto.getRandomValues()` 进行密码学安全随机填充。
- **URL Token 验证行为安全收敛**：移除从 URL `?token=xxx` 自动发起 `verify` 的逻辑，改为仅回填输入框，杜绝社工链接消耗受害者失败配额的间接 DoS 风险。
- **智能静态扩展名放行机制**：收敛 `/plugins/` 门禁放行规则为合法前端静态扩展名白名单（`.js`, `.css`, `.png`, `.svg`, `.woff2`, `.map` 等 20+ 种），彻底堵死未授权调用第三方插件后台动态 API 的漏洞，对用户零负担、免手动维护。

### Robustness & Performance (健壮性与性能)
- **写盘分级与 Debounce 防抖**：拆分写盘策略，高频访问记录（`recordAuthVisit`、活跃时间戳更新）引入 500ms 防抖合并；关键路径（配对成功、密码认证、撤销、改密）保持同步即时写盘；配套 `beforeExit` 广播与 `flushPersistedData` 保证进程退出不丢数据。
- **配置一致性与反向覆盖防御**：`loadPersistedData` 完全移除对历史 `devices.json` 中 `data.config` 的读取，确保 `~/.dsh/settings.yaml` 为唯一配置权威来源，杜绝重启时的配置回滚。
- **YAML 原子性持久化**：`writeBackToSettingsYaml` 引入临时文件原子替换（`renameSync`），防止异常中断导致 `settings.yaml` 文件半写损坏。
- **RSA 密钥按需懒加载**：移除模块顶层同步生成密钥逻辑，改为在首次调用时懒加载单例，消除启动阻塞。
- **SSE 幂等注销与双向 Close 监听**：优化服务端 SSE 事件通道，同时监听 `req.on('close')` 与 `res.on('close')`，引入 `cleanup()` 幂等保护，杜绝监听器与定时器泄漏。

### Testing & Code Hygiene (测试与代码清理)
- **测试覆盖率提升**：新增 5 项边缘场景测试用例（含设备撤销审计归因回退、URL Token 提取、data.config 忽略防覆盖、高频写盘防抖、SSE 幂等断连清理），全套测试扩展至 66 项并全部通过。
- **冗余代码清理**：移除已废弃未引用的 `src/types/auth.ts`。

---

## [1.1.0] - 2026-08-22
- 初始稳定版发布：Tailscale & LAN 免密直连、RSA 端到端加密、6 位动态配对码、加盐哈希密码存储、IP 5次防暴破锁定与 SSE 实时事件推送。
