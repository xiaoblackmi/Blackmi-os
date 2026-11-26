# Blackmi OS / Blackmi Connect

面向科大讯飞 C6 等受限 Android WebView 环境的单文件 HTML 应用与局域网通信研究项目。Blackmi OS 是项目总称，并非可刷入设备的操作系统或 Android ROM。

> **2026-11-26 项目基线：** V1 双人通信、V2 八台设备群聊已由实机操作者报告成功；Core Lab 1.0 已取得详细实机报告。ESP32 常驻服务端、iPad 管理台和 DeepSeek AI 尚处于设计阶段，不宣称已实现。

## 文档导航
- [开发演进与源码索引](docs/HISTORY.md)
- [设备画像、权限及实测数据](docs/DEVICE-TESTS.md)
- [V1/V2 通信机制](docs/RTC-ARCHITECTURE.md)
- [V3 常驻服务器架构](docs/CORE-DESIGN.md)
- [客户端与管理员 UI 规格](docs/FRONTEND.md)
- [开发与验收路线](docs/ROADMAP.md)
- [测试数据 CSV](tests/core-lab-rtc.csv)
- [安全和公开发布说明](docs/SECURITY.md)

## 项目目标
在设备管理方授权的网络与应用范围内，以原生 HTML/CSS/JavaScript 构建轻量化、无需外部前端依赖的应用：多人即时通信、可恢复房间、文件与协作应用、可选 AI 服务。保留无需专用服务器的 WebRTC 临时群聊，与未来常驻 Core 模式明确区分。

## 当前验收
| 能力 | 状态 |
|---|---|
| V1 双人文字聊天 | 实机成功（用户报告） |
| V2 星型群聊 | 8 台实机成功（用户报告，未记录持续时长） |
| 7 对本机 DataChannel | 112/112 ACK，报告截图 |
| 二维码输入 | 系统文件选择器拍照/选图后解码；直接摄像头权限拒绝 |
| 页面跨重启存储 | LocalStorage 标记消失 |
| IndexedDB / Service Worker | 不可用 |
| ESP32 HTTP/WS/WSS | 待授权服务实测 |
| ESP32 固件、iPad 管理、DeepSeek | 规划，未验收 |

不改变设备管理或网络访问策略，不做通用代理。本仓库不含账号密码、密钥、实机 SDP、设备唯一标识或原始现场照片。第三方 QR 库授权声明应随原代码保留；项目整体授权许可证尚未由所有者确定。
