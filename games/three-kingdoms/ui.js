(function(game) {
  'use strict';
  var heroes = Object.create(null);
  game.heroes.forEach(function(hero) { heroes[hero.id] = hero; });
  var phaseNames = {mode:'议程', prepare:'准备', judge:'判定', draw:'摸牌', play:'出牌', discard:'弃牌', end:'结束'};
  var prompts = {mode:'选快速或标准', play:'选择手牌、技能或军令', discard:'点牌弃置，或自动弃齐', guard:'以拒阵化解来袭',
    duel:'交出锋牌继续论阵', rescue:'济伤可救回濒死者', stars:'选择一张牌置顶', rewrite:'可用手牌替换判定',
    harry:'选择袭仓目标，或正常摸牌', scheme:'花费军势，或转出一张手牌'};
  var sideNames = {court:'主公与忠臣胜', rebel:'反贼胜', rogue:'内奸独胜', draw:'粮尽 · 和局'};
  var hits = {thrust:'进锋',feint:'佯攻',flame:'万炬',gale:'借风',banner:'合檄'};
  var seals = {朱:'M4 16L12 5l8 11-8 3z M8 15h8', 玄:'M12 4l8 8-8 8-8-8z M12 8v8',
    霞:'M4 17h16M6 13l6-8 6 8M8 10h8', 霜:'M5 6h14v12H5z M8 9l8 6m0-6l-8 6'};
  var PLAY_PAGE = 12;

  var css = `
.tk{--tk-ink:#ecdfbe;--tk-muted:#b5bbac;--tk-panel:#1a2928;--tk-gold:#e2b85e;--tk-rule:#52614e;
 display:grid;grid-template-rows:auto minmax(62px,1fr) auto;gap:5px;width:100%;height:100%;min-width:0;min-height:0;
 padding:6px 9px;background:#182725;color:var(--tk-ink);font:12px system-ui,sans-serif;overflow:hidden}
.tk [hidden]{display:none!important}
.tk button{font:inherit;color:inherit;border:1px solid var(--tk-rule);border-radius:3px;background:#263630;
 cursor:pointer;min-width:0;margin:0;touch-action:manipulation}
.tk button:disabled{opacity:.46;cursor:default}
.tk button[aria-pressed=true],.tk button.tk-picked{background:#443a24;border-color:var(--tk-gold)}
.tk button:focus-visible{outline:2px solid #f0cb7a;outline-offset:-2px}
.tk button.tk-legal{border-color:#d7ac52;box-shadow:inset 0 0 0 1px #d7ac52}
.tk button.tk-turn{border-top:2px solid #e2b85e}
.tk button.tk-respond{border-bottom:2px solid #df996e}
.tk button.tk-source>b{color:#ead395}
.tk button.tk-dead{color:#b6aa95;background:#292c28}
.tk-row{display:flex;align-items:stretch;justify-content:center;min-width:0;min-height:1px}
.tk-row>.tk-seat{flex:1 1 0;max-width:175px}
.tk-row>.tk-seat+.tk-seat{margin-left:5px}
.tk-seat{min-height:46px;padding:3px 5px;text-align:left;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.tk-seat>b,.tk-seat span,.tk-seat small,.tk-identity small,.tk-identity strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.22}
.tk-seat>b{font-size:12px}.tk-seat>span{font-size:10px;color:var(--tk-muted)}.tk-seat>small{font-size:10px}
.tk-seat em{color:var(--tk-gold);font-style:normal}
.tk-arena{position:relative;display:grid;grid-template-columns:minmax(82px,1fr) minmax(0,5fr) minmax(82px,1fr);gap:6px;min-height:0}
.tk-side{display:flex;min-width:0;align-items:center}.tk-side>.tk-seat{width:100%}
.tk-center{position:relative;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:3px;overflow:hidden;
 padding:4px 7px;text-align:center;background:#223630;border:1px solid #495848}
.tk-ring{position:absolute;right:2%;bottom:-26px;width:145px;height:113px;opacity:.28;pointer-events:none}
.tk-center>*:not(svg){z-index:1;max-width:100%}.tk-summary{display:flex;align-items:center;min-height:14px;color:#ddc899}
.tk-center>.tk-summary{z-index:4}
.tk-summary button{padding:1px 5px;font-size:10px}
.tk-summary>*+*{margin-left:7px}
.tk-hint{font-size:13px;line-height:1.2;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;width:100%;font-weight:650}
.tk-detail,.tk-effect{min-height:12px;color:#c4c7ac;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;width:100%;font-size:10px;line-height:1.15}
.tk-effect{color:#e9d5ac}.tk-clock[data-urgent=true]{color:#ffc2a3}
.tk-match-time{font-variant-numeric:tabular-nums;color:#c3c5ac}
.tk-clock{font-variant-numeric:tabular-nums;color:#f3c864;min-width:28px;font-weight:750}
.tk-bottom{display:grid;grid-template-columns:90px minmax(0,1fr) 151px;min-width:0;gap:6px;align-items:stretch}
.tk-self{display:flex;flex-direction:column;min-width:0}
.tk-identity{display:flex;flex:1;flex-direction:column;justify-content:center;align-items:flex-start;padding:3px 5px;text-align:left}
.tk-identity strong{width:100%;font-size:13px}.tk-identity small{width:100%;color:var(--tk-muted);font-size:10px}
.tk-self [data-hero]{font-size:10px;min-height:19px;text-align:left;padding:2px 5px}
.tk-self [data-hero]{margin-top:3px}
.tk-hand-wrap{min-width:0;display:flex;align-items:stretch;gap:3px}
.tk-page{display:flex;flex-direction:column;justify-content:center;gap:3px}.tk-page button{width:22px;min-height:24px;padding:0}
.tk-hand{display:flex;overflow:auto hidden;min-height:64px;min-width:0;flex:1;padding:2px 1px 3px;align-items:stretch}
.tk .tk-card{position:relative;display:flex;flex:0 0 57px;flex-direction:column;align-items:center;justify-content:center;
 padding:2px 1px;color:#25332d;background:#efe4ca;border-color:#a8a18a;border-top:2px solid #6f7562;line-height:1.15}
.tk .tk-card[data-type=锦囊]{border-top-color:#9f6b30}
.tk .tk-card[data-type=延时]{border-top-color:#83555f}
.tk .tk-card[data-type=武器],.tk .tk-card[data-type=防具],.tk .tk-card[data-type=进攻马],.tk .tk-card[data-type=防御马]{border-top-color:#586f76}
.tk-card svg{position:absolute;bottom:2px;right:4px;width:22px;height:22px;opacity:.24;pointer-events:none}
.tk-card>span,.tk-card>b{z-index:1}
.tk-card+.tk-card{margin-left:4px}
.tk-card b{font-size:12px;white-space:nowrap}.tk-card span:first-of-type{font-size:9px;align-self:flex-start;margin-left:4px}.tk-card span:last-child{font-size:20px;font-weight:700}
.tk-card[data-red=true] span{color:#9b3624}
.tk .tk-card[aria-pressed=true]{border-color:#ffdc7d;box-shadow:inset 0 0 0 2px #d99936;background:#fff0c8}
.tk .tk-card[data-option=false]{background:#b9b7a2}.tk-card:empty{display:none}
.tk-controls{display:flex;flex-direction:column;justify-content:center;min-width:0}
.tk-tools,.tk-submit{display:flex;align-items:center;justify-content:flex-end}
.tk-tools button{padding:0 4px;min-height:25px;flex:0 1 auto;font-size:11px;white-space:nowrap}
.tk-tools button+button,.tk-submit button+button{margin-left:3px}
.tk-tools+.tk-submit{margin-top:4px}
.tk-submit button{height:35px;padding:0 6px;white-space:nowrap;flex:1 1 auto}
.tk-submit [data-confirm]{background:#e2b85e;color:#261b0e;border-color:#e2b85e;font-weight:800}
.tk-center .tk-panel{position:absolute;z-index:3;inset:20px 3px 2px;background:#25362e;color:#f0e8cf;border:1px solid #a38752;overflow:auto;text-align:left;padding:3px 8px}
.tk-panel p{margin:1px 0;white-space:pre-line}.tk-summary span{white-space:nowrap}
.tk-panel button{float:right;padding:2px 8px}.tk-tempo{display:flex;align-items:center;min-width:0}
.tk-tempo button{min-height:36px;padding:0 9px;white-space:nowrap}.tk-tempo button+button{margin-left:5px}
.tk-status-note{color:#ddc899;text-align:center;margin:auto}
@media(max-height:450px){
 .tk{grid-template-rows:38px minmax(50px,1fr) 56px;gap:4px;padding:4px 6px}
 .tk-seat{min-height:38px;padding:2px 4px}
 .tk-seat>b{font-size:11px}.tk-seat>span,.tk-seat>small{font-size:9px}
 .tk-seat>b,.tk-seat>span,.tk-seat>small,.tk-identity strong,.tk-identity small{line-height:1.12}
 .tk-center{padding:2px 5px}.tk-detail,.tk-effect{min-height:11px}.tk-identity{padding:2px 4px}
 .tk-summary{font-size:10px}.tk-summary>*+*{margin-left:5px}
 .tk-identity strong{font-size:11px}.tk-identity small{font-size:9px}.tk-hand{min-height:0;padding:1px 1px 2px}
 .tk-submit button{height:32px}.tk-tools button{min-height:20px}
}
@media(min-height:460px){
 .tk{padding:10px 12px;gap:9px}.tk-seat{min-height:65px;font-size:13px}.tk-seat>b{font-size:15px}.tk-seat small,.tk-seat>span{font-size:12px}
 .tk-hint{font-size:17px}.tk-detail{font-size:12px}.tk-hand{min-height:100px}.tk-card+.tk-card{margin-left:6px}.tk .tk-card{flex-basis:71px}
 .tk-card b{font-size:15px}.tk-card span:last-child{font-size:28px}.tk-bottom{grid-template-columns:114px minmax(0,1fr) 170px}
 .tk-tools button{min-height:33px}.tk-submit button{height:44px}
}
@media(max-width:630px){
 .tk{padding:3px 4px}.tk-arena{grid-template-columns:minmax(56px,1fr) minmax(0,4fr) minmax(56px,1fr)}
 .tk-bottom{grid-template-columns:65px minmax(0,1fr) 116px}.tk-controls button{padding:0 3px;font-size:10px}
}
`;

  function text(node, value) {
    value = String(value);
    if (node.textContent !== value) node.textContent = value;
  }
  function show(node, on) { if (node.hidden === on) node.hidden = !on; }
  function pressed(node, value) {
    var flag = String(value);
    if (node.getAttribute('aria-pressed') !== flag) node.setAttribute('aria-pressed', flag);
  }
  function cardName(id) { return game.cards[game.deck[id].key].name; }
  function cardDetail(id) { return game.cards[game.deck[id].key].detail; }
  function make(tag, className) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (tag === 'button') el.type = 'button';
    return el;
  }

  game.mount = function(ctx, play, session) {
    var style = make('style');
    style.textContent = css;
    var root = make('section', 'tk');
    root.setAttribute('aria-label','汉末逐鹿牌桌');
    root.innerHTML = '<div class="tk-row" data-rivals></div><div class="tk-arena">' +
      '<div class="tk-side" data-left></div><div class="tk-center">' +
      '<svg class="tk-ring" viewBox="0 0 145 113" aria-hidden="true"><g fill="none" stroke="#d0a55a">' +
      '<circle cx="81" cy="63" r="46"/><circle cx="81" cy="63" r="38"/>' +
      '<path d="M0 97L33 55l22 22 21-37 14 31 18-26 37 52M7 103h131M70 25l11-12 11 12"/></g></svg>' +
      '<div class="tk-summary"><span data-round></span><span data-deck></span><span class="tk-match-time" data-match-clock></span>' +
      '<span class="tk-clock" data-clock></span><button type="button" data-info>详情</button><button type="button" data-log>战报</button></div>' +
      '<div class="tk-hint" data-hint aria-live="polite"></div><div class="tk-effect" data-effect></div><div class="tk-detail" data-detail></div>' +
      '<div class="tk-panel" data-feed hidden></div><div class="tk-panel" data-inspector hidden>' +
      '<button type="button" data-close-info>收起</button><strong data-info-title></strong><p data-info-body></p></div>' +
      '</div><div class="tk-side" data-right></div></div>' +
      '<div class="tk-bottom"><div class="tk-self"><button type="button" class="tk-identity" data-self>' +
      '<strong></strong><small></small><small></small></button><button type="button" data-hero></button></div>' +
      '<div class="tk-hand-wrap"><div class="tk-tempo" data-tempo hidden><button type="button" data-mode="fast">快速 18 分</button>' +
      '<button type="button" data-mode="standard">标准 35 分</button></div><div class="tk-hand" data-hand></div>' +
      '<div class="tk-page" data-page hidden><button type="button" data-page-back aria-label="手牌上一页">‹</button>' +
      '<button type="button" data-page-next aria-label="手牌下一页">›</button></div></div>' +
      '<div class="tk-controls"><div class="tk-tools">' +
      '<button type="button" data-mode="skill">技能</button><button type="button" data-mode="ward">立垒</button>' +
      '<button type="button" data-mode="march">行军</button><button type="button" data-mode="armor">披甲</button>' +
      '<button type="button" data-mode="yield">付军势</button><button type="button" data-return>回席</button></div><div class="tk-submit">' +
      '<button type="button" data-cancel>取消</button><button type="button" data-pass>略过</button>' +
      '<button type="button" data-confirm>确定</button></div></div></div>';
    play.appendChild(style);
    play.appendChild(root);

    var $ = selector => root.querySelector(selector);
    var rivals = $('[data-rivals]'), left = $('[data-left]'), right = $('[data-right]');
    var hand = $('[data-hand]'), own = $('[data-self]'), heroButton = $('[data-hero]');
    var hint = $('[data-hint]'), detail = $('[data-detail]'), clock = $('[data-clock]'), matchClock = $('[data-match-clock]');
    var effect = $('[data-effect]'), tempo = $('[data-tempo]'), returnButton = $('[data-return]');
    var inspector = $('[data-inspector]'), infoTitle = $('[data-info-title]'), infoBody = $('[data-info-body]');
    var round = $('[data-round]'), deckCount = $('[data-deck]'), feed = $('[data-feed]');
    var pageTools = $('[data-page]'), pageBack = $('[data-page-back]'), pageNext = $('[data-page-next]');
    var confirm = $('[data-confirm]'), cancel = $('[data-cancel]'), pass = $('[data-pass]');
    var modeButtons = Array.from(root.querySelectorAll('[data-mode]'));
    var ownParts = Array.from(own.children);
    var slots = [], cards = new Map(), zoneKey = '', feedKey = '', activePage = 0;
    var state = null, privateView = {}, stateId = '', seq = -1, timer = 0, localDeadline = 0, localMatchDeadline = null;
    var selected = null, target = null, mode = 'card', inspectHero = false, inspectSeat = null;
    var frame = ctx.onRender(draw);
    var spectator = make('div','tk-status-note');
    text(spectator,'观战席 · 可查看公开战况');

    for (var i = 0; i < 8; i++) {
      var button = make('button','tk-seat');
      button.dataset.seat = i;
      var name = make('b'), meta = make('span'), status = make('small');
      button.appendChild(name);
      button.appendChild(meta);
      button.appendChild(status);
      slots.push({button:button,name:name,meta:meta,status:status});
    }

    function clearChoice() { selected = null; target = null; mode = 'card'; inspectHero = false; inspectSeat = null; }
    function choices() { return privateView.options || []; }
    function skipChoice() { return choices().find(entry => ['pass','end-turn','auto-discard'].includes(entry.action.kind)); }
    function modeChoice(action, key) {
      if (key === 'fast' || key === 'standard') return action.kind === 'set-mode' && action.choice === key;
      if (key === 'skill') return action.kind === 'skill';
      if (key === 'ward' || key === 'march') return action.kind === 'command' && action.choice === key;
      if (key === 'armor' || key === 'yield') return action.kind === key;
      return ['play','discard','respond','choose'].includes(action.kind);
    }
    function group() {
      return choices().find(function(entry) {
        if (!modeChoice(entry.action, mode)) return false;
        return mode !== 'skill' && mode !== 'card' || entry.action.card === (selected === null ? undefined : selected);
      });
    }
    function readyOption() {
      var entry = group();
      if (!entry) return null;
      if (!entry.targets.length) return entry.action;
      return entry.targets.includes(target) ? Object.assign({},entry.action,{target:target}) : null;
    }
    function canAct() { return state && state.phase === 'play' && session.status().canAct; }
    function send(action) {
      if (action && canAct() && state.data.pending &&
          session.submit(state.id, Object.assign({},action,{seq:state.data.pending.seq}))) {
        clearChoice();
        frame.invalidate();
      }
    }
    function displayClock() {
      clearTimeout(timer);
      timer = 0;
      if (!ctx.isActive() || !state || state.phase !== 'play' || !state.data.pending) {
        text(clock,'');
        text(matchClock,'');
        return;
      }
      var leftMs = Math.max(0, localDeadline - Date.now());
      text(clock,(state.data.pending.auto ? '速过 ' : '响应 ') + Math.ceil(leftMs / 1000) + '秒');
      clock.dataset.urgent = String(leftMs <= 5000);
      if (localMatchDeadline !== null) {
        var seconds = Math.ceil(Math.max(0,localMatchDeadline-Date.now())/1000);
        text(matchClock,'全局 ' + Math.floor(seconds/60) + ':' + ('0' + seconds%60).slice(-2));
      } else text(matchClock,'');
      if (leftMs > 0) timer = setTimeout(displayClock,Math.max(40, leftMs % 1000 + 15));
    }
    function stopClock() { clearTimeout(timer); timer = 0; }
    ctx.cleanup(stopClock);

    function arrange(data, mySeat) {
      var key = state.id + ':' + mySeat;
      if (zoneKey === key) return;
      zoneKey = key;
      var indexes = data.seats.map((_,i) => i).filter(i => i !== mySeat);
      var sideLeft = indexes.shift(), sideRight = indexes.pop();
      left.appendChild(slots[sideLeft].button);
      right.appendChild(slots[sideRight].button);
      indexes.forEach(i => rivals.appendChild(slots[i].button));
      slots.forEach(function(slot,i) {
        if ((i === mySeat || i >= data.seats.length) && slot.button.parentNode) slot.button.remove();
      });
    }

    function gearLine(seat) {
      var worn = Object.values(seat.gear).filter(id => id !== null).map(id => game.cards[game.deck[id].key].mark);
      var result = worn.concat(seat.delayed.map(id => game.cards[game.deck[id].key].mark));
      if (seat.ward) result.push('垒');
      return result.join(' · ');
    }

    function updateSeats(data, mySeat, targets) {
      arrange(data,mySeat);
      data.seats.forEach(function(seat, i) {
        var n = slots[i], hero = heroes[seat.hero];
        text(n.name,(i+1) + ' ' + hero.name + (seat.role ? ' · ' + game.roles[seat.role] : ''));
        text(n.meta,session.playerName(seat.id) + ' · ' + (seat.alive ? seat.hp + '/' + seat.max + ' 体力' : '阵亡'));
        var distance = privateView.distances && privateView.distances[i];
        text(n.status,seat.away ? '暂离 · ' + seat.count + '牌' : seat.count + '牌 · ' + seat.power + '势' +
          (distance ? ' · 距' + distance[0] : '') + (gearLine(seat) ? ' · ' + gearLine(seat) : ''));
        n.button.title = hero.detail;
        n.button.classList.toggle('tk-dead',!seat.alive);
        n.button.classList.toggle('tk-turn',i === data.active);
        n.button.classList.toggle('tk-respond',!!data.pending && i === data.pending.seat && data.pending.type !== 'play');
        n.button.classList.toggle('tk-source',!!data.pending && i === data.pending.source);
        n.button.classList.toggle('tk-legal',targets.includes(i));
        n.button.classList.toggle('tk-picked',i === target);
      });
      var self = data.seats[mySeat];
      show(own,!!self);
      show(heroButton,!!self);
      if (!self) return;
      var hero = heroes[self.hero];
      own.dataset.seat = mySeat;
      own.classList.toggle('tk-legal',targets.includes(mySeat));
      own.classList.toggle('tk-picked',target === mySeat);
      text(ownParts[0],(mySeat+1) + ' ' + hero.name + ' · ' + hero.faction);
      text(ownParts[1],game.roles[privateView.role] + ' · ' + (self.alive ? self.hp + '/' + self.max : '阵亡'));
      text(ownParts[2],self.power + '势 · 射程' + self.range + (self.away ? ' · 暂离' : ''));
      text(heroButton,hero.skill + ' ⓘ');
      heroButton.title = hero.detail;
    }

    function createCard(id) {
      var card = game.deck[id], definition = game.cards[card.key];
      var button = make('button','tk-card');
      button.dataset.card = id;
      button.dataset.red = card.red;
      button.dataset.type = definition.type;
      var namespace = 'http://www.w3.org/2000/svg';
      var stamp = document.createElementNS(namespace,'svg'), line = document.createElementNS(namespace,'path');
      stamp.setAttribute('viewBox','0 0 24 24');
      stamp.setAttribute('aria-hidden','true');
      line.setAttribute('d',seals[card.suit]);
      line.setAttribute('fill','none');
      line.setAttribute('stroke','currentColor');
      stamp.appendChild(line);
      var mark = make('span'), name = make('b'), glyph = make('span');
      text(mark,card.suit + card.rank + ' ' + definition.type);
      text(name,definition.name);
      text(glyph,definition.mark);
      button.appendChild(mark);
      button.appendChild(name);
      button.appendChild(glyph);
      button.insertBefore(stamp,mark);
      button.setAttribute('aria-label',definition.name + ' ' + card.suit + card.rank);
      button.title = definition.detail;
      return button;
    }

    function updateHand(mySeat) {
      var inventory = privateView.look && privateView.look.length ? privateView.look : privateView.hand || [];
      var pages = Math.max(1,Math.ceil(inventory.length / PLAY_PAGE));
      activePage = Math.min(activePage,pages-1);
      var current = inventory.slice(activePage * PLAY_PAGE,(activePage + 1) * PLAY_PAGE);
      var eligible = new Set(choices().filter(entry => modeChoice(entry.action,mode)).map(entry => entry.action.card));
      for (var item of cards) {
        if (!current.includes(item[0])) {
          item[1].remove();
          cards.delete(item[0]);
        }
      }
      if (mySeat < 0 && !spectator.parentNode) hand.appendChild(spectator);
      else if (mySeat >= 0 && spectator.parentNode) spectator.remove();
      current.forEach(function(id, i) {
        var button = cards.get(id);
        if (!button) {
          button = createCard(id);
          cards.set(id,button);
        }
        if (hand.children[i] !== button) hand.insertBefore(button,hand.children[i] || null);
        pressed(button,id === selected);
        var playable = String(eligible.has(id));
        if (button.dataset.option !== playable) button.dataset.option = playable;
      });
      show(pageTools,pages > 1);
      pageBack.disabled = activePage === 0;
      pageNext.disabled = activePage >= pages - 1;
    }

    function responseLine(data,w) {
      if (!w) return '';
      function name(index) { return (index+1) + '席 ' + heroes[data.seats[index].hero].name; }
      var actor = name(w.seat), source = w.source === null ? '' : name(w.source);
      switch (w.type) {
        case 'mode': return actor + '选择节奏，超时采用标准';
        case 'guard': return source + ' → ' + actor + ' · ' + hits[w.mode] +
          ' · 未应对 1 伤害' + (w.pierce ? '，穿护垒' : '，护垒可抵消') +
          (w.mode === 'feint' || w.mode === 'banner' ? '，可付 1 势' : '');
        case 'duel': return source + ' → ' + actor + ' · 论阵 / 应锋 · 放弃受 1 伤害';
        case 'rescue': return '伤害来源 ' + source + ' · ' + name(w.target) + '濒死 · ' + actor + '应救';
        case 'rewrite': return actor + '改兆 → ' + name(w.target) + ' · ' + cardName(w.order);
        case 'scheme': return source + ' → ' + actor + ' · 离席计 · 付 1 势或暗转手牌';
        case 'stars': return actor + '观象 · 兆牌仅本人可见';
        case 'harry': return actor + '袭仓 · 目标失一牌，你少摸一张';
        case 'discard': return actor + '弃牌 · 上限 ' + data.discardLimit + ' 张';
        default: return actor + '出牌 · 射程 ' + data.seats[w.seat].range + ' · 已出锋 ' + data.attacks + '/' + data.attackLimit;
      }
    }

    function drawInspector(data,mySeat) {
      var seat = inspectHero ? mySeat : inspectSeat;
      if (seat !== null && seat >= 0) {
        var viewed = data.seats[seat], hero = heroes[viewed.hero];
        var pair = privateView.distances && privateView.distances[seat];
        var status = '射程 ' + viewed.range + (pair && seat !== mySeat ? ' · 你到对方 ' + pair[0] + ' / 对方到你 ' + pair[1] : '');
        var worn = Object.values(viewed.gear).concat(viewed.delayed).filter(id => id !== null);
        text(infoTitle,(seat+1) + '席 · ' + hero.name + ' · ' + hero.faction);
        text(infoBody,hero.skill + ' · ' + hero.detail + '\n' + status + '\n' +
          (worn.length ? worn.map(id => cardName(id) + ' · ' + cardDetail(id)).join('\n') : '装备与延时区为空') +
          (viewed.ward ? '\n护垒待结算' : ''));
      } else if (selected !== null) {
        var card = game.deck[selected];
        text(infoTitle,cardName(selected) + ' · ' + card.suit + card.rank);
        text(infoBody,cardDetail(selected));
      } else {
        text(infoTitle,'距离与护垒');
        text(infoBody,'座次按存活者顺逆取近。进攻马减出距离，防御马加进距离。长槊的锋可穿护垒。点任一座位查看技能和装备。');
      }
    }

    function draw() {
      if (!state) return;
      var data = state.data, mySeat = privateView.seat === undefined ? -1 : privateView.seat;
      var w = data.pending, live = canAct(), me = w && w.seat === mySeat;
      var g = group(), targets = g ? g.targets : [];
      updateSeats(data,mySeat,live ? targets : []);
      updateHand(mySeat);
      var choosing = !!(w && w.type === 'mode' && me && live);
      show(tempo,choosing);
      show(hand,!choosing);
      var actor = w ? heroes[data.seats[w.seat].hero].name : '';
      var tempoLabel = data.mode === 'fast' ? '快' : '标';
      text(round,data.mode ? tempoLabel + ' ' + data.turn + '/' + data.turnCap + ' · ' + phaseNames[data.phase] : '开局议程');
      text(deckCount,'牌堆 ' + data.pile + ' · 弃牌 ' + data.discard);
      text(hint,state.phase === 'aborted' ? '对局已中止' : data.result ? data.result.reason === 'clock' ?
        '全局时限 · 和局' : sideNames[data.result.side] :
        w ? (me ? prompts[w.type] : actor + ' · ' + prompts[w.type]) : '结算中');
      text(effect,state.phase === 'play' ? responseLine(data,w) : '');
      var info = data.top === null ? '' : '弃牌堆顶 · ' + cardName(data.top);
      if (inspectSeat !== null) {
        var viewed = data.seats[inspectSeat];
        info = heroes[viewed.hero].detail + (gearLine(viewed) ? ' ' + gearLine(viewed) : '');
      }
      if (mode === 'ward') info = '军令 · 花 2 军势为一个座位立垒';
      if (mode === 'march') info = '军令 · 花 2 军势，范围 +2，本回合多一次主动锋';
      if (mode === 'armor') info = '藤甲 · 花 1 军势替代拒阵';
      if (mode === 'yield') info = '军势 · 花 1 军势化解当前行动';
      if (mode === 'fast' || mode === 'standard') {
        info = mode === 'fast' ? '18 分钟 · 累计出牌 24 秒 · 应锋 5 秒' : '35 分钟 · 累计出牌 40 秒 · 应锋 8 秒';
      }
      if (inspectHero && mySeat >= 0) info = heroes[data.seats[mySeat].hero].detail;
      if (selected !== null) info = cardDetail(selected);
      if (targets.length && target === null && live) info = '点选高亮座位 · ' + info;
      if (live && me && w.type !== 'play') {
        var skill = choices().find(entry => entry.action.skill);
        if (skill) info = '可发动 ' + heroes[skill.action.skill].skill + ' · ' + info;
      }
      text(detail,info);
      if (!inspector.hidden) drawInspector(data,mySeat);
      if (!feed.hidden && feedKey !== data.feed.join('|')) {
        feedKey = data.feed.join('|');
        Array.from(feed.children).forEach(node => node.remove());
        data.feed.slice().reverse().forEach(message => {
          var line = make('p');
          text(line,message);
          feed.appendChild(line);
        });
      }
      modeButtons.forEach(function(button) {
        var key = button.dataset.mode;
        if (key === 'skill' && mySeat >= 0) text(button,heroes[data.seats[mySeat].hero].skill);
        show(button,live && choices().some(entry => modeChoice(entry.action,key)));
        pressed(button,mode === key);
      });
      show(returnButton,live && choices().some(entry => entry.action.kind === 'resume'));
      var skipOption = skipChoice();
      pass.disabled = !live || !skipOption;
      text(pass,w && w.type === 'play' ? '出牌完' : w && w.type === 'discard' ? '自动弃' : '略过');
      confirm.disabled = !live || !readyOption();
      cancel.disabled = selected === null && target === null && mode === 'card' && !inspectHero && inspectSeat === null;
      displayClock();
    }

    ctx.listen(root,'click',function(event) {
      if (!state) return;
      var button = event.target.closest('button');
      if (!button || !root.contains(button)) {
        if (!event.target.closest('.tk-panel')) { feed.hidden = true; inspector.hidden = true; }
        return;
      }
      if (button.hasAttribute('data-log')) {
        feed.hidden = !feed.hidden;
        inspector.hidden = true;
      } else if (button.hasAttribute('data-info')) {
        inspector.hidden = !inspector.hidden;
        feed.hidden = true;
      } else if (button.hasAttribute('data-close-info')) {
        inspector.hidden = true;
      } else if (button.hasAttribute('data-hero')) {
        clearChoice();
        inspectHero = true;
        inspector.hidden = false;
        feed.hidden = true;
      } else if (button.hasAttribute('data-page-back') || button.hasAttribute('data-page-next')) {
        activePage += button.hasAttribute('data-page-back') ? -1 : 1;
        clearChoice();
        hand.scrollLeft = 0;
      } else if (button.hasAttribute('data-cancel')) {
        clearChoice();
      } else if (button.hasAttribute('data-confirm')) {
        send(readyOption());
      } else if (button.hasAttribute('data-pass')) {
        var skip = skipChoice();
        if (skip) send(skip.action);
      } else if (button.hasAttribute('data-return')) {
        send({kind:'resume'});
      } else if (button.dataset.mode) {
        var key = button.dataset.mode;
        mode = mode === key ? 'card' : key;
        target = null;
        if (mode !== 'skill') selected = null;
      } else if (button.dataset.card !== undefined) {
        var card = Number(button.dataset.card);
        if (mode !== 'card' && mode !== 'skill') mode = 'card';
        selected = selected === card ? null : card;
        target = null;
        inspectHero = false;
        inspectSeat = null;
        inspector.hidden = true;
      } else if (button.dataset.seat !== undefined) {
        var seat = Number(button.dataset.seat), current = group();
        if (current && current.targets.includes(seat)) {
          target = target === seat ? null : seat;
          inspector.hidden = true;
        } else {
          inspectHero = false;
          inspectSeat = seat;
          inspector.hidden = false;
          feed.hidden = true;
        }
      }
      frame.invalidate();
    });

    return {
      render:function(next, hidden) {
        var pending = next.data.pending, nextSeq = pending ? pending.seq : -1, fresh = stateId !== next.id;
        if (fresh || seq !== nextSeq) {
          clearChoice();
          localDeadline = pending ? Date.now() + pending.remainingMs : 0;
          seq = nextSeq;
          inspector.hidden = true;
        } else if (pending) {
          var resumed = state.data.pending.auto && !pending.auto;
          var estimated = Date.now() + pending.remainingMs;
          localDeadline = resumed ? estimated : Math.min(localDeadline,estimated);
        }
        var remaining = next.data.matchRemainingMs;
        if (remaining === null) localMatchDeadline = null;
        else {
          var estimate = Date.now() + remaining;
          localMatchDeadline = fresh || localMatchDeadline === null ? estimate : Math.min(localMatchDeadline,estimate);
        }
        if (fresh) {
          activePage = 0;
          stateId = next.id;
          feed.hidden = true;
        }
        state = next;
        privateView = hidden;
        frame.invalidate();
      },
      pause:stopClock,
      reset:function() { state = null; stateId = ''; stopClock(); clearChoice(); }
    };
  };
})(BlackmiThreeKingdoms);
