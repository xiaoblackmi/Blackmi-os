# Blackmi OS — Codex / AI 开发规则

先阅读 PROJECT_CONTEXT.md、ARCHITECTURE.md、SDK.md、TESTING.md、CHANGELOG.md、docs/ROADMAP.md、docs/SECURITY.md、docs/PAD_CAPABILITIES.md、docs/PERFORMANCE_BUDGET.md。当前确认的 main 发布源码为 client/Blackmi_OS_V3.4_AI_Arena_RC2.html（审查提交 098563447b65f12e6b3aefabfc8b9d5715ea018a，PAD 实机待验）；任何新版本先核实 Git 提交及文件，不凭聊天猜测。若用户指定更新基线，以其明确指示和可检查源码为准。

## 硬约束
- 单 HTML、自包含、纯 PAD 优先，Android 9 / Chromium 80 / WPS WebView，834×360 与 960×600 横屏，触控优先。无 CDN、运行时框架依赖；避免可选链、空值合并、逻辑赋值等较新语法/API，必要时验证或降级。
- 聊天核心、桥接、WebRTC Transport、ICE/SDP、QR 编解码、聊天协议、GameLink transport 冻结；普通游戏只改规则/UI 与最小注册/工厂接入。不得将游戏 JSON 塞入聊天或改连接参数；确需修复单独说明和审查。
- 不依赖 IndexedDB、Service Worker、BroadcastChannel、直接摄像头、SharedArrayBuffer 或跨重启本地持久化；扫码使用现有文件选择器。
- 保留宿主 AI 来源标识及可见安全区、第三方许可声明；仅获授权设备和网络；不规避权限，不提交密钥、SDP 或个人数据。
- 不声称模拟、接口探测、历史版本测试等于当前真机验收。公开仓库不等于整体开源许可。

## 开发方法
先检查源码、描述变更范围和风险。新游戏独立规则/测试，复用 Lobby/座位/快照/ACK/评论及 gameApp，房主权威、秘密状态按接收人隔离。已合并的 V3.2.2 SDK 提供随 HTML 打包的 `BlackmiSDK.games.register`，面向回合制。App 网络能力的 `gameData:false` 仍指聊天 SDK 无通用游戏传输。最小化 DOM 改动；使用 `ctx.listen`、`ctx.cleanup`，按需绘制优先用 `ctx.onRender`；后台停止绘制，不引入重型素材和无上限缓存。
不要原地覆盖历史发布 HTML；新构建明确版本，统一面向用户的版本展示（协议版本独立）。遵循 TESTING.md。默认不改通信与既有游戏，不为视觉重构牺牲性能。
交付写明变更、文件大小、测试证据、未验收项、回滚基线；同步 README/CHANGELOG/PROJECT_CONTEXT/SDK（接口变化时）。修改当前发布指针须有完整可核实产物；不自动把计划标为发布。每个独立任务优先单独提交或分支。

## PAD 实测约束
每次新游戏及性能改动遵循 docs/PERFORMANCE_BUDGET.md 的初始软预算；依据 docs/PAD_CAPABILITIES.md 选择 API。Canvas 主线程绘制、Worker 可选计算、DOM 增量更新、回合制事件驱动。不得依赖 OffscreenCanvas、直接剪贴板或下载成功；不能把本机 RTC 回环当跨设备联机验收。超预算须说明并实测，不为性能预算改通信协议。

## AI Arena 扩展约定

V3.4 AI Arena RC2 已合入 main，从已审查的 V3.3 RC2 独立构建。机器人只能使用房主复制的本席投影和合法动作，通过大厅原入口执行。真人成员、连接、虚拟座位分别计数。新策略应有有界复杂度、覆盖规则边界与隐藏信息反事实测试。保留现有的断线和协议语义。构建与测试入口见 [人机开发指南](sdk/bots/README.md)。
