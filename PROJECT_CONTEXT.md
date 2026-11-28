# Blackmi OS 项目交接基线（2026-11-28）

本文件是跨 ChatGPT/Codex 会话的交接入口，不是聊天逐字稿。以 GitHub 已提交源码和实测为事实来源；旧对话恢复不完整。当前 main 发布基线为 [V3.4 AI Arena RC2](client/Blackmi_OS_V3.4_AI_Arena_RC2.html)，审查提交 `098563447b65f12e6b3aefabfc8b9d5715ea018a`，合并提交 `5ed722cc4e21d56727e0ea809c7edc5e71245cff`，Git blob `b8244de87346556ee0a79f6bbd9631189e5826f4`，677344 bytes / 661.47 KiB。PR #2/#3/#4 已依次合并，15 款游戏、5 款 AI。目标 PAD 实机待验。项目是单 HTML Web 桌面，不是系统 ROM。

## 决策
- 当前主线纯 PAD，获授权局域网、无专用服务器、无 CDN、原生 HTML/CSS/JS/Canvas/WebRTC；不把 ESP32/AI 提案当作现有功能。
- 先保障实际设备流畅、稳定、可触控；834×360 优先，960×600 次之；类 macOS 简约，不堆动画。
- 通信核心冻结；聊天和游戏独立星型网络，房主权威。游戏共用大厅配对，一次一场，赛前选座/准备/观战；不将游戏消息混入聊天。
- 保留宿主 AI 来源标识与安全区；不绕过设备权限。
- 设备 CB-C6-STU Android 9 / Chromium 80 / WPS WebView / opaque sandbox origin=null。存储只能作为会话缓存；直接摄像头不可用，文件选择器拍照扫码可用。

## 当前功能与证据
V1 双人聊天、V2 八台群聊由操作者报告实机通过；V2.7 首批三款游戏操作者报告可用。Core Lab 7 对本机连接 112/112 ACK，总计 288.7ms，中位 RTT 72.1ms（不是 Wi-Fi 延迟）。V3.1.2 有开发机运行与客户端截图证据，尚无该版本 C6 多人联机、长时内存、实机 FPS 验收。
14 款游戏：五子棋、你画我猜、斗地主、德州扑克、中国象棋、八球台球、传话画画、谁是卧底、UNO、坦克大战、太空足球、躲猫猫、王国争霸、合作生存。用户曾反馈坦克大战流畅；具体版本、人数、帧率未恢复。德州扑克等仅无现金价值娱乐积分。游戏实现范围见 README。
V3.1.3 Composer Fix 已归档（消息输入布局与版本显示修复）；V3.2 Arcade 和 V3.2.1 Kingdoms Reborn 已合入 main。王国争霸为48省、2–8国、45秒规划、每轮最多4条私有指令、最多20轮的同步战略。大厅协议321；所有参与者统一客户端。分支 README 报告70次地图生成检查、外交/私有指令、14款游戏模拟开局与代表性快照10232字符；未在本次合并重新执行测试，完整浏览器视觉与 C6 真机联机待验。
## 下次开发
先读 AGENTS.md、SDK.md、ARCHITECTURE.md、TESTING.md、CHANGELOG.md、docs/ROADMAP.md。确认目标分支/源码；保留旧构建；每次记录变更、文件大小、测试证据、未验收风险。正式基线 V3.4 AI Arena RC2；后续开发先核查 main 最新提交。旧对话未完整找回，发现新证据及时补充。

## 2026-11-28 Hardware Lab V2.0 实机基线
[能力矩阵](docs/PAD_CAPABILITIES.md)、[性能预算](docs/PERFORMANCE_BUDGET.md)、[原始简化 JSON](tests/Blackmi_PAD_Lab_mwzt8gbr.json)。批次 mwzt8gbr，16/16 QR，CRC32 37252d8d；960×600 短时合成负载，2000简单对象59.6FPS，Worker 1MiB Transferable 往返0.3ms，7对本机 RTC 56/56 ACK。实际跨机通信、内存、后台存活、834×360、长时间游戏性能仍待验收。该报告非 V3.2.1 全功能验收。后续开发按软预算和能力矩阵执行。

## V3.2.2 Developer SDK 候选

基线提交 `266ba0c1810d7bf8f50fbe2baba6637cd585c8b4`。候选 [Blackmi_OS_V3.2.2_DeveloperSDK.html](client/Blackmi_OS_V3.2.2_DeveloperSDK.html) 提供 `BlackmiSDK.apps`、`BlackmiSDK.games`、按需绘制和回合制登记。后续 SDK 游戏先写规则和 UI 模块，用 [打包脚本](sdk/bundle.cjs) 生成单 HTML，开发接口见 [SDK.md](SDK.md)。仓库保留 V3.2.1 为历史回滚基线。审查通过的 SDK 稳定性提交为 `2b6ab18bb0c8136cffcba40176539e9169684cdc`。

## V3.3 Three Kingdoms 候选

`feature/3.3-three-kingdoms` 以 `2b6ab18` 为父提交，用 SDK 接入 [汉末·逐鹿](games/three-kingdoms/README.md)。4–8 人可玩，含四身份、12 位武将、108 张牌和军势。新增模块位于 `games/three-kingdoms/`。[候选单 HTML](client/Blackmi_OS_V3.3_ThreeKingdoms.html) 包含 15 款游戏。

49 项自动测试、125 局模拟、14 款旧游戏开局和 Chromium 80 双视口证据见 [TESTING.md](TESTING.md)。PAD 多机、长时性能与真人平衡性待验。

### V3.3 RC2 复审候选

PR #3 的发布前体验迭代在 `e16e2ce` 上开发。[RC2 单 HTML](client/Blackmi_OS_V3.3_ThreeKingdoms_RC2.html) 增加快速/标准计时、同一出牌阶段累计预算、暂离回席和八人牌桌响应提示。[规则与运行说明](games/three-kingdoms/README.md) · [复测与阵营机器人矩阵](TESTING.md)

原 V3.3、V3.2.2 和 V3.2.1 产物继续保留。真人阵营平衡、目标 PAD 联机及长时性能待验。

## V3.4 AI Arena 开发候选

开始开发时，PR #2 草稿头为 `2b6ab18bb0c8136cffcba40176539e9169684cdc`，PR #3 草稿头为 `c1781b7faf6d8b9f2152612dfab0291729a2bd1f`，两者仍开放。实际开发分支 `feature/3.4-ai-arena` 从 PR #3 已审查的 RC2 提交开始，复审目标为 `feature/3.3-three-kingdoms`。

[候选 HTML](client/Blackmi_OS_V3.4_AI_Arena.html) 提供五款内置游戏的离线与混桌 AI，15 款全部保留真人开局。房主 Bot Manager、座位管理和各游戏适配器在 `sdk/bots/`。旧 HTML、底层通信和三国 RC2 规则冻结。[测试与性能记录](TESTING.md) · [构建指南](sdk/bots/README.md)

真实 PAD 上的单机、真人混合跨设备联机、输入与长时内存仍待验收。

### V3.4 AI Arena RC2

PR #4 的策略复审候选从已审查的 `7c4756462aa872179e5ceace9655d2613434f1a9` 开发。王国补充本席影子规划和跨回合战略记忆，五子棋增加有界威胁搜索。Bot Manager、SDK、通信核心和王国权威结算按 RC1 比对。[候选 HTML](client/Blackmi_OS_V3.4_AI_Arena_RC2.html) · [复测](TESTING.md#v34-ai-arena-rc2)

## 2026-11-28 main 发布交接

PR #2（SDK）、#3（三国 RC2）、#4（AI Arena RC2）依次合入 main，最新下载已指向 RC2，未改动客户端字节。合并提交依次为 `a11bc911e82f509fdac1c24ae01b97d18bc0b153`、`4ba5b98240b69207d33f361af9e806e4d246d9e9`、`5ed722cc4e21d56727e0ea809c7edc5e71245cff`。独立 RC2 复审验证重构建、11项冻结区域、30局王国及32局五子棋（16013次策略决策）；开发者报告86/86测试及Chromium 80双视口通过。真实RTC仍止于ICE收集超时，C6/WPS单机、混桌及长时性能待验收。V3.5 Runtime SDK 为后续拟议方向，尚未启动。
