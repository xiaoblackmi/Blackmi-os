# Blackmi OS 项目交接基线（2026-11-28）

本文件是跨 ChatGPT/Codex 会话的交接入口，不是聊天逐字稿。以 GitHub 已提交源码和实测为事实来源；旧对话恢复不完整。审查基线 main dad7b699e3fdaa0c70b766d99a85fc0061e590b7（PR #1 合并 feature/3.2.1-kingdoms），客户端 [V3.2.1 Kingdoms Reborn](client/Blackmi_OS_V3.2.1_Kingdoms.html)，Git blob cb0630b013fdab48e5976c082509882e650dbd5b，README 记录 556718 bytes / 544 KiB。项目是单 HTML Web 桌面，不是系统 ROM。

## 决策
- 当前主线纯 PAD，获授权局域网、无专用服务器、无 CDN、原生 HTML/CSS/JS/Canvas/WebRTC；不把 ESP32/AI 提案当作现有功能。
- 先保障实际设备流畅、稳定、可触控；834×360 优先，960×600 次之；类 macOS 简约，不堆动画。
- 通信核心冻结；聊天和游戏独立星型网络，房主权威。游戏共用大厅配对，一次一场，赛前选座/准备/观战；不将游戏消息混入聊天。
- 保留宿主 AI 来源标识与安全区；不绕过设备权限。
- 设备 CB-C6-STU Android 9 / Chromium 80 / WPS WebView / opaque sandbox origin=null。存储只能作为会话缓存；直接摄像头不可用，文件选择器拍照扫码可用。

## 当前功能与证据
V1 双人聊天、V2 八台群聊由操作者报告实机通过；V2.7 首批三款游戏操作者报告可用。Core Lab 7 对本机连接 112/112 ACK，总计 288.7ms，中位 RTT 72.1ms（不是 Wi-Fi 延迟）。V3.1.2 有开发机运行与客户端截图证据，尚无该版本 C6 多人联机、长时内存、实机 FPS 验收。
14 款游戏：五子棋、你画我猜、斗地主、德州扑克、中国象棋、八球台球、传话画画、谁是卧底、UNO、坦克大战、太空足球、躲猫猫、王国争霸、合作生存。用户曾反馈坦克大战流畅；具体版本、人数、帧率未恢复。德州扑克等仅无现金价值娱乐积分。游戏实现范围见 README。
V3.1.3 Composer Fix 已归档（消息输入布局与版本显示修复）；V3.2 Arcade 和 V3.2.1 Kingdoms Reborn 已合入 main。王国争霸为48省、2–8国、45秒规划、每轮最多4条私有指令、最多20轮的同步战略。大厅协议321；所有参与者统一客户端。分支 README 报告70次地图生成检查、外交/私有指令、14款游戏模拟开局与代表性快照10232字符；未在本次合并重新执行测试，完整浏览器视觉与 C6 真机联机待验。V3.3 三国身份战尚未实现。
## 下次开发
先读 AGENTS.md、SDK.md、ARCHITECTURE.md、TESTING.md、CHANGELOG.md、docs/ROADMAP.md。确认目标分支/源码；保留旧构建；每次记录变更、文件大小、测试证据、未验收风险。以 V3.2.1 为基线，优先验证输入布局修复与实机稳定性，再做三国身份战原型。旧对话未完整找回，发现新证据及时补充。

## 2026-11-28 Hardware Lab V2.0 实机基线
[能力矩阵](docs/PAD_CAPABILITIES.md)、[性能预算](docs/PERFORMANCE_BUDGET.md)、[原始简化 JSON](tests/Blackmi_PAD_Lab_mwzt8gbr.json)。批次 mwzt8gbr，16/16 QR，CRC32 37252d8d；960×600 短时合成负载，2000简单对象59.6FPS，Worker 1MiB Transferable 往返0.3ms，7对本机 RTC 56/56 ACK。实际跨机通信、内存、后台存活、834×360、长时间游戏性能仍待验收。该报告非 V3.2.1 全功能验收。后续开发按软预算和能力矩阵执行。

## V3.2.2 Developer SDK 候选

基线提交 `266ba0c1810d7bf8f50fbe2baba6637cd585c8b4`。候选 [Blackmi_OS_V3.2.2_DeveloperSDK.html](client/Blackmi_OS_V3.2.2_DeveloperSDK.html) 提供 `BlackmiSDK.apps`、`BlackmiSDK.games`、按需绘制和回合制登记。后续 SDK 游戏先写规则和 UI 模块，用 [打包脚本](sdk/bundle.cjs) 生成单 HTML，开发接口见 [SDK.md](SDK.md)。仓库保留 V3.2.1 为正式下载和回滚基线，三国身份战仍是后续任务。
