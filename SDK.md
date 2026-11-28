# Blackmi App SDK 1.0 与游戏集成指南

直接依据 V3.2.1 源码 L211–256、L2063–2119，不把提案当成接口。SDK 并非 npm 包或可独立加载的游戏网络服务。

## 已有公共 App API
window.BlackmiApps: version='1.0', register(def), launch(id), close(id), list(), networkStatus(), capabilities(), diagnostics()。
def: id（正则 ^[a-z][a-z0-9-]{1,31}$，唯一），name（24 字符），en（32 字符），icon（现有图标名），color（6 位十六进制），desktop（可选 true），mount(ctx) 返回 activate/deactivate/unmount 钩子对象。
ctx: id, root, isActive(), listen(target,event,fn,opts), onFrame(fn(now,dt)), cleanup(fn), on(event,fn), emit(event,data), onNetwork(fn), onTheme(fn), notify(title,msg), storage.get(key,fallback)/set/remove, network.getStatus()/capabilities()/openConnection()。
on/emit 是应用内部事件，不是网络。onFrame 只在前台活动，关闭/最小化/切换/页面隐藏自动停止；cleanup 关闭时反序执行。onTheme/onNetwork 立即提供当前状态。storage 使用 JSON 可复制数据、每应用 JSON.stringify 长度最多 65536 个 JS 字符（不是字节），关闭重开同一 HTML 可恢复，不保证页面重启。network 仅聊天房间状态与连接窗口，gameData:false。

```js
BlackmiApps.register({
  id:'demo-counter',name:'计数器',en:'Counter',icon:'apps',color:'#426a9f',
  mount:function(ctx){
    var b=document.createElement('button'),n=ctx.storage.get('n',0);
    b.textContent=String(n);ctx.root.appendChild(b);
    ctx.listen(b,'click',function(){ctx.storage.set('n',++n);b.textContent=String(n);});
    return {};
  }
});
```

## 多人游戏：现有内部集成契约（不是公共 SDK）
BlackmiGameLink 只公开 status()/diagnostics()；BlackmiGameRules 暴露若干规则测试类/函数。GameLink service/Lobby 在闭包中，不能从独立外部脚本直接访问。
新回合制游戏：在独立文件开发纯规则模块（可测试），再在现有游戏闭包内做最小集成。参考 Uno、Undercover、Holdem 或 KingdomMatch，不照搬坦克/Arcade 实时分支。
- 规则对象 constructor(players,...) 初始化 pub:{id,kind,players,phase,rev,winner,...}；秘密状态不得进入 pub。privateFor(id) 仅返回本玩家可见的副本；观战者返回空或公开许可信息。
- act(id,action) 验证身份、阶段、轮次、所有权、合法参数；普通回合制成功返回 null 以走现有 snapshot。tick() 返回是否有状态变化；Lobby 负责增加 rev。不得直接信任客户端状态。当前 Lobby.sync（L2075）对 ArcadeMatch/KingdomMatch 使用 publicFor(id)，其他游戏使用 pub；新游戏若需逐玩家公共视图，必须审查这一接入点，不能仅定义 publicFor 就假设它被调用。
- 在 titles、minPlayers/maxPlayers/needText、Lobby.start 工厂及游戏中心/图标元数据补注册；使用内部 gameApp(kind,mount)，mount(ctx,play) 返回 render(publicState,privateState)，可选 pause/reset；用既有 service.act(action) 提交操作，ctx.listen/cleanup/onFrame 管理资源。
- 复用座位、准备、观战、评论、结束对局、快照、ACK；不修改 Link、ICE/SDP、QR、聊天协议，不新增通用网络消息协议。新规则/状态兼容性需要显式核验，同版本对局；当前大厅协议 lobbyRev=321；不要为了表面版本一致改握手数字。
- 若未来需要外部多人插件 SDK，另开架构任务，设计受控的 game registry/adapter、能力检测与测试；当前没有该 API。
## Codex 交付
独立 rules + UI 原型 + 规则测试 + 集成差异 + 单 HTML 产物。无需 npm/CDN 运行时；开发测试依赖可以本地使用但不进入发布 HTML。不得复制无授权卡面、音频或第三方规则实现；保留已有许可声明。见 AGENTS.md / TESTING.md。
