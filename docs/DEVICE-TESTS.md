# 设备画像与验收报告

日期：2026-11-26（实机 Core Lab 报告截图约 20:08–20:09；操作者后续确认跨重启标记消失）。数据是截图转录与操作者反馈，不是厂家规格或独立第三方验收。

## 基本信息
| 字段 | 观察值 |
|---|---|
| 设备型号（UA） | CB-C6-STU（科大讯飞 C6 学生平板） |
| OS | Android 9，Build/PPR1.180610.011 |
| 浏览器引擎 | Chrome/80.0.3987.132，Android WebView (wv) |
| 宿主 | WpsMoffice/14.3.0/armeabi-v7a/1530/appIsTablet |
| UA 内核 | AppleWebKit/537.36，Version/4.0，Safari/537.36 |
| 视口 | 960×600 CSS px（早期曾为 834×360），DPR 2 |
| CPU | navigator.hardwareConcurrency = 8（逻辑线程提示） |
| 内存 | navigator.deviceMemory = 4 GB（浏览器近似值，不是物理内存测量） |
| 网络 | navigator.onLine=true；effectiveType=4g、rtt=0、downlink=9.3（浏览器估算，不证明是蜂窝网络或互联网可达） |
| 运行形态 | HTTPS、secureContext=true、iframe=true、origin=null |
| 部署 | 用户报告：平台导入单 HTML，经 WPS WebView 运行；页面退出后重新初始化 |

## 权限矩阵
| 项目 | 状态及证据 |
|---|---|
| JS / CSS / Flex | 可运行；早期外部 CDN 样式和布局不稳定 |
| Canvas 2D | 通过；像素读取 255 |
| WebGL 1 | 通过；MAX_TEXTURE_SIZE=4096 |
| WASM | 实际计算返回 42 |
| Worker | 实际计算返回 4999950000 |
| WebRTC | 本机回环通过；两台及八台群聊用户报告成功 |
| FileReader / Blob | 内存文件读回一致 |
| AudioContext | running，48000 Hz；不代表麦克风或扬声器均验收 |
| crypto.getRandomValues | 实际生成 16 字节 |
| Web Crypto subtle | 接口存在，未实际加解密验收 |
| LocalStorage | 64 KiB ASCII 读写删除 0.3 ms；完全退出再打开旧标记消失 |
| SessionStorage | 64 KiB ASCII 读写删除 0.1 ms；跨重启不依赖 |
| IndexedDB | SecurityError，open denied in this context |
| Storage estimate | TypeError: The operation is not supported in this context |
| Service Worker | SecurityError: context sandboxed and lacks allow-same-origin flag |
| BroadcastChannel | 早期实际创建失败：opaque origin；本次仅探测接口存在 |
| SharedArrayBuffer | 接口不存在 |
| WebTransport | 接口不存在 |
| Permissions API | 接口不存在 |
| Clipboard API / Web Locks | 接口存在，未验收 |
| Fetch / XHR / WebSocket | 接口存在；GET、POST、握手和 Echo 未实测 |
| getUserMedia 摄像头 | NotAllowedError: Permission denied；操作者确认一直不可用 |
| 系统文件选择器 | 可通过拍照或选择图片输入 QR，再在 HTML 内解码；不是直接摄像头权限 |
| 麦克风 / 后台驻留 / 音视频通话 | 未验收 |
| 外部网站导航 | 部分获准站点可达；其他失败；无证据确定管控的实现层或可访问端口 |

origin=null 与 Service Worker 错误支持 opaque sandbox 结论；secureContext=true 不代表同源、跨域、摄像头或任意网络权限。不要将 iframe 沙箱与网络策略直接等同。

## 性能报告
| 测试 | 样本 | 结果 |
|---|---|---|
| JSON | 12轮，每轮500条，最后一轮66281字符 | 22.4 ms，总计；读回500条 |
| WASM | 实例化与返回42 | 15.9 ms |
| Worker | 启动并计算 0..99999 求和 | 24.5 ms |
| 主线程定时器 | 目标20ms，25次，页面可见 | 中位20.4ms，最大20.8ms |
| LocalStorage | 64KiB ASCII 读写删除 | 0.3ms，非容量上限 |
| SessionStorage | 同上 | 0.1ms，非容量上限 |

## DataChannel 本机回环并发
每对含两个 RTCPeerConnection，每对发送16条约1 KiB载荷，接收端返回带序号的ACK；统计总体耗时和 ACK 往返时间（含本机排队）。无 STUN/TURN。不是端到端真实 Wi-Fi 带宽或 ESP32 性能测试。

| 对数 | 建立 | ACK | 总耗时 ms | RTT 中位 ms | RTT 最大 ms |
|---:|---:|---:|---:|---:|---:|
| 1 | 1/1 | 16/16 | 72.6 | 19.2 | 21.6 |
| 3 | 3/3 | 48/48 | 144.4 | 34.4 | 73.7 |
| 7 | 7/7 | 112/112 | 288.7 | 72.1 | 114.5 |

实机跨设备 V2：操作者报告 8 人群聊无问题；尚无时长、消息总数、真实 RTT、丢包率或网络拓扑抓包证据。7对回环相当于14个端点，不等同8台设备压力测试。

## 持久化复现
写入 Core Lab 标记 -> 完全退出 HTML -> 重开同一 HTML -> 检查旧标记（不覆盖）。结果：消失。只能依赖内存临时状态，服务端应保存账户及历史。无法证明所有类型的存储都必然丢失，但本项目不依赖其跨重启持久性。

## 下一步
在获得设备与网络管理方授权的环境，用明确的测试服务验证 GET/POST、CORS、WS/WSS握手与 Echo、TLS证书链及重连。无服务器不能测试真实端口；失败时记录错误，不能仅凭 JavaScript TypeError 判断是防火墙、证书、混合内容、CORS 或服务未运行。
