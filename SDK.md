# Blackmi Developer SDK 1.0

开发入口是 [V3.2.2 Developer SDK 候选构建](client/Blackmi_OS_V3.2.2_DeveloperSDK.html)。`window.BlackmiSDK` 提供本地应用和回合制游戏注册。`BlackmiSDK.apps === BlackmiApps`，沿用 App SDK 1.0。正式构建 V3.2.1 使用 [原有 App SDK 和内置游戏接入方式](https://github.com/xiaoblackmi/Blackmi-os/blob/266ba0c1810d7bf8f50fbe2baba6637cd585c8b4/SDK.md)。

## 快速开始

1. 复制 [本地计数器](sdk/examples/counter.js) 或 [回合制取石子](sdk/examples/take-stones.js)，更换唯一 ID 并实现业务逻辑。编辑器可以加载 [TypeScript 类型声明](sdk/blackmi-sdk.d.ts)。
2. 在仓库根目录用 Node.js 生成单 HTML。脚本按参数顺序内嵌在已初始化的 SDK 后。输出路径必须是新文件。
3. 在浏览器或获授权的 WPS WebView 打开输出 HTML。从桌面或启动台打开应用，从游戏中心进入新游戏。所有联机参与者使用同一份打包 HTML。

```sh
node sdk/bundle.cjs Blackmi_OS_DevDemo.html sdk/examples/counter.js sdk/examples/take-stones.js
node --test tests/developer-sdk.test.cjs
```

打包输入是受信任的普通 JS 脚本。需要多个文件时可先内嵌规则，再内嵌注册代码。Node 和类型工具仅用于开发。模块跟随 HTML 启动，资源内嵌，不使用 CDN、运行时模块加载或远程插件。

## 本地应用

| API | 用途 |
|---|---|
| `apps.register(def)` | 注册应用并返回 ID。ID 为 `^[a-z][a-z0-9-]{1,31}$`，全局唯一。支持 `name`（24字符）、`en`（32字符）、`icon`（内置图标）、`color`（六位 HEX）、`desktop`、`wide`（宽窗口并默认最大化） |
| `apps.launch(id)` / `apps.close(id)` / `apps.list()` | 打开、关闭和查看应用 |
| `apps.networkStatus()` / `apps.capabilities()` / `apps.diagnostics()` | 聊天房间状态、能力和最近的 SDK 异常，能力中的 `gameData` 为 `false` |

`mount(ctx)` 可返回 `activate(ctx)`、`deactivate(ctx)`、`unmount(ctx)`。在 `ctx.root` 内建立 UI，`ctx.isActive()` 判断是否处于可见前台。

| Context API | 用途 |
|---|---|
| `ctx.listen(target,event,fn,options)` / `ctx.cleanup(fn)` | 绑定事件或登记释放函数。返回取消函数，窗口关闭时自动逆序清理 |
| `ctx.onRender(draw)` | 返回 `invalidate()` 和 `dispose()`。同一帧的多次请求合并。最小化、切换应用或页面隐藏时暂停，恢复前台后绘制尚未处理的一帧。初次绘制也需调用 `invalidate()` |
| `ctx.onFrame(fn)` | 实时动画可使用的连续前台帧回调，参数 `now` 与 `dt` 为毫秒，`dt` 最大 100ms。返回取消函数 |
| `ctx.storage.get(key,fallback)` / `set(key,value)` / `remove(key)` | JSON 会话状态。每应用 JSON 字符串上限 65,536 个 JS 字符。关闭窗口再打开可恢复，页面重建后视为丢失 |
| `ctx.on(event,fn)` / `ctx.emit(event,data)` | 应用内部事件。JSON 数据通过页面内的应用事件总线 |
| `ctx.onTheme(fn)` / `ctx.onNetwork(fn)` | 订阅主题和聊天房间状态，注册时立即提供当前值 |
| `ctx.notify(title,message)` | 桌面通知 |
| `ctx.network.getStatus()` / `capabilities()` / `openConnection()` | 聊天状态、能力和连接窗口。发游戏动作使用下节的对局接口 |

## 回合制游戏

`BlackmiSDK.games.register(def)` 统一注册大厅卡片、人数、窗口、规则工厂与 UI。只能在 HTML 解析阶段调用。填写 `id`、`name`、`minPlayers`、`maxPlayers`、`createMatch`、`mount`。可选 `en`、`color`、`mark`（封面符号或短文本）。人数为 2–8 的连续区间。大厅最多 8 人含房主和观战者。注册返回游戏 ID。`games.list()` 提供游戏和人数信息，`games.status()` 提供大厅角色、阶段、在线人数、当前游戏。

### 房主规则

`createMatch({players,hostId,finish})` 由房主开局时同步调用。`players` 是已入座玩家 ID 的只读数组，`hostId` 可能属于观战者。把规则和原始状态放在工厂闭包内。每局使用新实例。

- `act(playerId,action)` 执行一步合法操作。房主从连接确定玩家 ID。规则验证轮次或步骤号、动作参数、所有权和当前状态。非法动作在修改状态前抛出 `Error`。错误消息会发给提交者，请保持简短且不包含秘密。
- `publicFor(viewerId)` 返回 JSON 对象。玩家收到其可见视图，所有观战者的 `viewerId` 都是 `null`。SDK 只同步函数返回的投影，投影放在 `state.data`。
- 可选 `privateFor(playerId)` 返回该玩家自己的 JSON 对象。观战者自动收到空对象。隐藏身份、手牌、秘密指令放这里，或只在该玩家的公共投影中暴露其允许看到的内容。投影函数应无副作用。
- 可选 `tick(now)` 接受房主时间戳，由既有 Lobby 约每 500ms 调用。发生需要同步的变化时返回 `true`。操作或计时规则可用 `finish(winnerId)` 结束，平局传 `null`。
- 动作与投影使用 JSON 值。动作 `kind` 由小写字母开头，允许小写字母、数字和连字符，最多 48 字符。`comment` 和 `stroke` 由既有引擎保留。客户端传来的字段按未知值做类型、边界和范围校验。

### 客户端界面

`mount(ctx,play,game)` 在 `play` 容器建立对局内容，返回 `render(state,privateState)`。可选 `pause()`、`reset()`。按只读快照更新 UI，不在画面里算权威状态。SDK 提供 `state.id`、`kind`、`players`、`phase`（`play`、`end`、`aborted`）、`rev`、`winner`、`comments` 和 `data`。

- `game.status()` 给出 `playerId`、`role`、`canAct` 和 `pending`。`canAct` 表示前台、已入座且可提交，当前轮次和动作是否合法仍由规则判断。
- `game.submit(state.id,action)` 走既有动作、快照和 ACK。返回 `false` 表示本地拦截或提交失败，返回 `true` 表示房主已接受或成员请求已排队。成员以新快照、ACK 和大厅提示确认结果。
- `game.playerName(id)` 读取大厅昵称。使用 `textContent` 渲染用户输入，不拼入 `innerHTML`。
- 座位、准备、观战、评论和结束对局由现有大厅提供。注册接口面向回合制。内置绘画、坦克和 Arcade 继续使用各自的同步实现。

## PAD 适配

- 先做 834×360，再测 960×600。使用 Pointer Events，处理 `pointercancel` 和 `lostpointercapture`。输入框在拼音合成期间避免提交。
- 默认 Canvas 2D 主线程绘制。非持续动画使用 `onRender` 或直接更新变动节点。有二次计算重负载再测可选 Worker，关闭时释放。
- 普通游戏快照以约 16 KiB 为软目标。避免每帧刷新 DOM。应用状态留在会话，保留文件选择和手动交互回退。
- 宿主剪贴板和媒体权限在最新实测被拒绝，文件导出未成功，`OffscreenCanvas` 不可用。当前实测 RTC 仅验证了单台回环。详见 [PAD 能力](docs/PAD_CAPABILITIES.md)、[性能预算](docs/PERFORMANCE_BUDGET.md) 和 [验收记录](TESTING.md)。
