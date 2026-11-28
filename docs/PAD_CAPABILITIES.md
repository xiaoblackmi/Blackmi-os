# PAD 能力与实测基线

- 工具：Blackmi Hardware Lab V2.0；批次 `mwzt8gbr`；16/16 QR，拼接 ASCII JSON CRC32 `37252d8d` 核验通过。
- 数据：`Blackmi_PAD_Lab_mwzt8gbr.json` 为还原的简化报告，并非完整报告。960×600 CSS px，DPR 2，8 逻辑线程提示、4 GiB 设备内存估计，secure=true，opaque=true。型号/Android/UA 取自历史设备档案，本批简化报告没有 UA。
- 既有项目基线 V3.2.1；本工具独立运行，不是 V3.2.1 游戏性能验收。

## 能力矩阵
| 项目 | 本批证据 | 开发决策 |
|---|---|---|
| Canvas 2D | 像素读取成功；100/500/1000/2000 简单对象 61.2/59.8/59.7/59.6 FPS | 主线程绘制、静态缓存、按需更新 |
| WebGL 1 | 像素读回成功；纹理及 renderbuffer 上限4096 | 可选，需单独做复杂场景和上下文恢复测试 |
| Worker | 启动估计12.4ms；1MiB Transferable 往返0.3ms，原 buffer detach 且返回数据验证通过；32次计算190.5ms（计算累计176.8ms） | 可选后台计算；有限任务队列、关闭释放、失败降级 |
| WASM | 编译及实例化1.1ms；10万次返回常量调用13.7ms，结果正确 | 可选，不代表比JS更快 |
| OffscreenCanvas | 主线程构造 ReferenceError；Worker 测试因主线程构造失败无法进一步验证 | 不依赖 |
| Web Crypto | 随机数、SHA-256 摘要长度通过 | 可用，非完整加密协议验收 |
| Local/SessionStorage | 64Ki字符临时读写通过；显示0ms（计时分辨率） | 会话缓存；历史跨退出标记消失，不依赖持久化 |
| IndexedDB / BroadcastChannel | SecurityError / NotSupportedError | 不依赖 |
| Storage estimate | TypeError | 不依赖 |
| Clipboard read/write | NotAllowedError | 保留手动选择/复制与QR，手动复制未记录 |
| Camera/Microphone | NotAllowedError | 不依赖直接媒体权限 |
| FileReader/Blob/图片文件选择 | 成功，211286 bytes，1803×1128 | 可用；限制图像大小并释放 URL |
| Blob 导出 | 点击触发，用户确认未保存 | 不依赖下载作唯一导出方式 |
| AudioContext | running / 48000Hz；用户未听到声音 | 音效非必要功能 |
| Vibration | API true，用户未感到振动 | 不依赖 |
| Pointer Events / Capture | 两指、728次 move、2次 capture、2次 up、0 cancel、2次 lost | 支持双指；继续验证越界、长时与宿主手势 |
| IME | 用户确认可输入；1 input，0 composition/Enter，视口600→600 | 未充分验证拼音 composition、软键盘遮挡 |
| 黑屏恢复 | 用户确认成功 | 仅应用遮罩，不代表系统休眠恢复 |
| 后台运行 | 7.59秒，75 ticks，最大间隔101ms；hidden=0、changes=0 | 未发生实际后台切换，不能判定后台存活 |
| WebRTC | 1/3/7 对本机回环成功，8/24/56 ACK | 跨设备测试尚未通过：ICE checking + Error，根因未知 |

简化报告未包含 memory/json/完整 API 清单、完整每帧 CPU 样本或测试中止字段。本批不能给出堆内存上限、JSON 序列化性能、实际跨设备吞吐、长期稳定性或834×360实测结论。历史 Service Worker、SharedArrayBuffer 等限制仍按 DEVICE-TESTS.md 处理。
