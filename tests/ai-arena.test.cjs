const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const {test}=require('node:test');
const {build,base,rc1,release}=require('../sdk/bots/build.cjs');

function random(seed){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
function scripts(file){return Array.from(fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),x=>x[1]);}
function gameScript(file){return scripts(file).find(x=>x.includes('class Lobby {'));}
function plain(x){return JSON.parse(JSON.stringify(x));}
function world(seed=1,file=release,clock=performance){
  let time=100000;
  const rng=random(seed), ctx=vm.createContext({performance:clock,console,document:{readyState:'loading'},
    Date:class extends Date{static now(){return time;}},
    crypto:{getRandomValues(a){for(let i=0;i<a.length;i++)a[i]=rng()*4294967296;return a;}},
    setInterval:()=>0,BlackmiApps:{register(){},close(){}}});
  vm.runInContext(gameScript(file).replace('})(globalThis);','globalThis.Test={Lobby,Match,Uno,Holdem,KingdomMatch,SdkRoundMatch,ArenaBots:typeof ArenaBots==="undefined"?null:ArenaBots,unoCard,sdkGames,kingdomPlan:typeof BlackmiArenaPolicies==="undefined"?null:BlackmiArenaPolicies.kingdomPlan};\n})(globalThis);'),ctx);
  for(const code of scripts(file).slice(-5))vm.runInContext(code,ctx);
  return {...ctx.Test,ctx,now:()=>time,advance:ms=>{time+=ms;}};
}
function paired(w,host,name){
  const guest=new w.Lobby(),received=[],messages=[];
  const local={token:'fixture-token',last:w.now(),opened:true,flush(){},send(m){received.push(plain(m));messages.push(()=>{remote.last=w.now();guest.receive(remote,plain(m));});return true;},
    close(){this.dead=true;host.drop(this,'closed');}};
  const remote={token:local.token,last:w.now(),opened:true,flush(){},send(m){messages.push(()=>{local.last=w.now();host.receive(local,plain(m));});return true;},
    close(){this.dead=true;guest.drop(this,'closed');}};
  host.pending=local;host.links.push(local);
  guest.role='guest';guest.lobby=host.lobby;guest.name=name;guest.pending=remote;guest.links.push(remote);guest.open(remote);
  function drain(){while(messages.length)messages.shift()();}
  drain();
  return {guest,local,remote,received,drain};
}
function seat(host,id,slot){host.assign(id,slot,host.me);host.setReady(id,true,slot);}
function scene(w,kind,count=2){
  const l=new w.Lobby();l.create('Host');l.prepare(kind);seat(l,l.me,0);l.fillBots(count);l.botManager.random=()=>.5;l.start(kind);return l;
}

test('virtual seats are independent of eight real members and respect host authority',()=>{
  const w=world(),host=new w.Lobby();
  host.create('Host');
  const guests=Array.from({length:7},(_,i)=>paired(w,host,'Guest '+i));
  const drain=()=>guests.forEach(p=>p.drain());
  drain();
  host.prepare('uno');
  seat(host,host.me,0);seat(host,guests[0].guest.me,1);
  host.fillBots(8);
  assert.equal(host.players.length,8);
  assert.equal(host.links.length,7);
  assert.equal(host.setup.bots.length,6);
  assert.equal(new Set(host.setup.seats).size,8);
  const id=host.setup.seats[2];
  assert.match(id,/^bot-[a-f0-9]{24}$/);
  drain();
  assert.throws(()=>guests[1].guest.configureBot(2,'remove'),/只有房主/);
  guests[1].guest.seat(2);drain();
  assert.equal(host.setup.seats[2],id);
  assert.match(guests[1].guest.error,/已被占用/);
  host.configureBot(2,'difficulty','easy');
  host.assign(id,3,host.me);
  assert.equal(host.setup.seats[3],id);
  assert(host.setup.ready.includes(id));
  host.configureBot(3,'remove');
  assert.equal(host.setup.seats[3],null);
  host.configureBot(3,'add');
  assert.notEqual(host.setup.seats[3],id);
  host.assign(guests[1].guest.me,3,host.me);
  assert(!host.setup.ready.includes(guests[1].guest.me));
  assert.throws(()=>host.start('uno'),/准备/);
  host.setReady(guests[1].guest.me,true,3);
  host.start('uno');drain();
  assert.equal(host.state.players.length,8);
  assert.equal(host.players.length,8);
  assert.deepEqual(plain(guests[6].guest.private),{});
  assert.equal(guests[6].guest.state.bots.length,5);
  const turn=host.match.pub.turn;
  guests[6].remote.send({v:1,lobby:host.lobby,t:'action',req:'spoof',match:host.state.id,id:host.state.bots[0].id,action:{kind:'draw'}});
  drain();
  assert.equal(host.match.pub.turn,turn);
  assert(!guests[6].received.some(m=>m.t==='ack'&&m.req==='spoof'));
});

test('AI IDs stay unique under repeated entropy and the registry leaves connection identities untouched',()=>{
  const w=world(),l=new w.Lobby();l.create('Host');l.prepare('uno');seat(l,l.me,0);
  w.ctx.crypto.getRandomValues=buffer=>buffer.fill(0);
  l.fillBots(8);
  const ids=l.setup.bots.map(bot=>bot.id);
  assert.equal(new Set(ids).size,7);
  assert(ids.every(id=>/^bot-[a-f0-9]{24}$/.test(id)));
  assert.equal(l.players.length,1);assert.equal(l.links.length,0);
});

test('isolated scheduler advances one action, survives comments, falls back and clears stale jobs',()=>{
  const w=world(),l=scene(w,'gomoku');
  const policy=w.ArenaBots.strategies.gomoku;
  assert.equal(l.links.length,0);
  assert.equal(l.action(l.me,{kind:'place',x:7,y:7}),true);
  l.tick();
  const due=l.botManager.pending.at,key=l.botManager.pending.key;
  l.action(l.me,{kind:'comment',text:'still same turn'});
  w.advance(500);l.tick();
  assert.equal(l.botManager.pending.at,due);
  assert.equal(l.botManager.pending.key,key);
  w.ArenaBots.strategies.gomoku=function(input){
    assert(Object.isFrozen(input.publicState.board));
    assert(Object.isFrozen(input.legalActions[0]));
    throw Error('test fallback');
  };
  w.advance(500);l.tick();
  assert.equal(l.state.moves.length,2);
  assert(l.log.some(line=>line.includes('合法默认')));
  w.ArenaBots.strategies.gomoku=policy;
  l.end();
  assert.equal(l.botManager.pending,null);
  for(let i=0;i<20;i++){
    l.prepare('gomoku');seat(l,l.me,0);l.fillBots(2);l.start('gomoku');
    l.action(l.me,{kind:'place',x:7,y:7});l.tick();
    assert(l.botManager.pending);
    l.end();w.advance(2000);l.tick();
    assert.equal(l.botManager.pending,null);
    assert.equal(Object.keys(l.botManager.active).length,0);
  }
  l.leave();
  assert.equal(Object.keys(l.botManager.setup).length,0);
});

test('Gomoku finds edge wins, a compulsory defense, five-plus and an open double threat',()=>{
  const w=world();
  const m=new w.Match('gomoku',['a','b']);
  const play=(stones,turn)=>{
    m.pub.board.fill(0);
    for(const [x,y,s] of stones)m.pub.board[y*15+x]=s;
    m.pub.turn=turn;
    const v=w.ArenaBots.adapters.gomoku.view(m);
    return plain(w.ArenaBots.strategies.gomoku({publicState:v.public,privateState:{},legalActions:v.actions,difficulty:'normal',random:()=>.5}));
  };
  assert.deepEqual(play([[0,0,1],[1,0,1],[2,0,1],[3,0,1]],0),{kind:'place',x:4,y:0});
  assert.deepEqual(play([[0,14,2],[1,14,2],[2,14,2],[3,14,2]],0),{kind:'place',x:4,y:14});
  assert.deepEqual(play([[1,1,1],[2,1,1],[4,1,1],[5,1,1],[6,1,1]],0),{kind:'place',x:3,y:1});
  const fork=play([[5,7,1],[6,7,1],[8,7,1],[7,5,1],[7,6,1],[7,8,1],[0,0,2],[1,2,2]],0);
  assert.deepEqual(fork,{kind:'place',x:7,y:7});
});

test('UNO adapter follows W4, draw-only and two-player reversal rules',()=>{
  const w=world(),m=new w.Uno(['a','b']),v=w.ArenaBots.adapters.uno;
  m.pub.color=0;m.pub.top=3;m.hands.a=[104,1,30];
  assert(!v.view(m,'a').actions.some(a=>a.card===104));
  m.hands.a=[104,30];
  assert.equal(v.view(m,'a').actions.filter(x=>x.card===104).length,4);
  m.pub.drawn=true;m.drawnId=30;
  assert.deepEqual(plain(v.view(m,'a').actions),[{kind:'pass'}]);
  m.pub.drawn=false;m.hands.a=[21,30];m.hands.b=[2];
  m.act('a',{kind:'play',card:21});
  assert.equal(m.pub.turn,0);
  assert.equal(m.pub.dir,-1);
});

function sim(w,kind,m,options={}){
  const ada=w.ArenaBots.adapters[kind],policy=w.ArenaBots.strategies[kind],rng=options.rng||random(541);
  const profile=Object.fromEntries(m.pub.players.map((id,i)=>[id,(options.profiles&&options.profiles[i])||{difficulty:i%2?'normal':'easy',
    persona:(w.ArenaBots.personas[kind]||[])[i%((w.ArenaBots.personas[kind]||[]).length)]||''}]));
  const times=[],outcomes={};
  let step=0,cursor=0;
  const memories=new Map();
  for(;step<(options.limit||4000)&&m.pub.phase==='play';step++){
    const turn=ada.turn(m,profile,cursor);
    if(!turn){if(options.human&&options.human(m,w))continue;break;}
    const t=performance.now(),view=ada.view(m,turn.id);
    const action=policy({publicState:plain(view.public),privateState:plain(view.private),legalActions:plain(view.actions),
      difficulty:profile[turn.id].difficulty,persona:profile[turn.id].persona,memory:memories.get(turn.id)||{},random:rng});
    times.push(performance.now()-t);
    const valid=view.actions.find(x=>JSON.stringify(x)===JSON.stringify(action));
    assert(valid,'illegal '+kind+' '+JSON.stringify(action));
    if(options.onAction)options.onAction(m,turn,valid,profile[turn.id]);
    m.act(turn.id,valid);
    if(ada.observe)memories.set(turn.id,ada.observe(view.public,memories.get(turn.id)||{}));
    cursor=turn.index+1;
    if(options.invariant)options.invariant(m);
  }
  outcomes[m.pub.phase]=1;
  return {step,times,outcomes};
}
function tally(obj,key){obj[key]=(obj[key]||0)+1;}
function summary(results){
  const times=results.flatMap(x=>x.times).sort((a,b)=>a-b),outcomes={};
  for(const result of results)for(const k of Object.keys(result.outcomes))outcomes[k]=(outcomes[k]||0)+result.outcomes[k];
  return {decisions:results.reduce((sum,x)=>sum+x.step,0),outcomes,p50:+times[Math.floor(times.length*.5)].toFixed(3),
    p95:+times[Math.floor(times.length*.95)].toFixed(3),max:+times.at(-1).toFixed(3)};
}

test('200 seeded Gomoku games and 200 seeded UNO games terminate with legal moves',t=>{
  const w=world(3401),gomoku=[],uno=[],reasons={};
  for(let i=0;i<200;i++){
    const a=new w.Match('gomoku',['black','white']),b=new w.Uno(Array.from({length:2+i%7},(_,j)=>'seat'+j));
    gomoku.push(sim(w,'gomoku',a,{rng:random(41000+i),limit:226}));
    assert.equal(a.pub.phase,'end');
    tally(reasons,a.pub.winner||'draw');
    assert.equal(new Set(a.pub.moves.map(x=>x.slice(0,2).join(','))).size,a.pub.moves.length);
    uno.push(sim(w,'uno',b,{rng:random(42000+i),limit:2000,invariant:m=>{
      const ids=[...m.deck,...m.pile,...Object.values(m.hands).flat()];
      assert.equal(ids.length,108);
      assert.equal(new Set(ids).size,108);
    }}));
    assert.equal(b.pub.phase,'end');
  }
  t.diagnostic(JSON.stringify({seeds:[3401,'41000–41199','42000–42199'],gomoku:{...summary(gomoku),reasons},uno:{...summary(uno),reasons:{emptyHand:uno.length}},exceptions:0}));
});

test('Three Kingdoms keeps tempo choices human and decisions invariant to hidden opponent hands',()=>{
  const w=world(),l=scene(w,'three-kingdoms',4),m=l.match;
  l.tick();
  assert.equal(l.botManager.pending,null);
  assert.equal(m.rules.window.type,'mode');
  l.act({kind:'set-mode',choice:'fast',seq:m.rules.window.seq});
  assert.equal(m.rules.mode,'fast');
  const r=m.rules,bot=r.seats[1].id;
  r.phase='play';r.active=1;r.window=null;r.jobs=[];r.open('play',1);
  const adapter=w.ArenaBots.adapters['three-kingdoms'];
  const before=plain(adapter.view(m,bot));
  const a=r.seats[2],b=r.seats[3];
  [a.hand[0],b.hand[0]]=[b.hand[0],a.hand[0]];
  if(a.role!=='lord'&&b.role!=='lord')[a.role,b.role]=[b.role,a.role];
  const after=plain(adapter.view(m,bot));
  assert.deepEqual(before,after);
  const choose=v=>plain(w.ArenaBots.strategies['three-kingdoms']({publicState:v.public,privateState:v.private,
    legalActions:v.actions,difficulty:'normal',memory:{},random:random(77)}));
  assert.deepEqual(choose(before),choose(after));
  assert.equal(before.private.role,r.seats[1].role);
  assert(!before.public.seats.some(seat=>'hand' in seat));
});

test('200 seeded Three Kingdoms policy games finish with intact card zones',t=>{
  const w=world(3402),results=[],reasons={},sides={};
  for(let i=0;i<200;i++){
    const ids=Array.from({length:4+i%5},(_,j)=>'seat'+j),m=new w.SdkRoundMatch(w.sdkGames['three-kingdoms'],ids,ids[0]);
    m.act(ids[0],{kind:'set-mode',choice:i%2?'fast':'standard',seq:m.rules.window.seq});
    results.push(sim(w,'three-kingdoms',m,{rng:random(43000+i),limit:4000,invariant:m=>{
      const r=m.rules,wnd=r.window,ids=r.pile.concat(r.discard);
      r.seats.forEach(p=>ids.push(...p.hand,...p.delay,...Object.values(p.gear).filter(x=>x!==null)));
      if(wnd&&wnd.order!==undefined)ids.push(wnd.order);
      if(wnd&&wnd.look)ids.push(...wnd.look);
      assert.equal(ids.length,108);assert.equal(new Set(ids).size,108);
      assert(r.seats.every(p=>p.power>=0&&p.power<=3));
      w.advance(800);
      m.tick();
    }}));
    assert.equal(m.pub.phase,'end');
    tally(reasons,m.rules.result.reason);
    tally(sides,m.rules.result.side);
  }
  t.diagnostic(JSON.stringify({seeds:[3402,'43000–43199'],threeKingdoms:{...summary(results),reasons,sides},exceptions:0}));
});

test('Holdem minimum raises, short all-ins, and human ownership of seat one',()=>{
  const w=world(),m=new w.Holdem(['a','b','c']),adapter=w.ArenaBots.adapters.holdem,p=m.pub;
  const i=p.turn,id=p.players[i];
  p.high=50;p.minRaise=30;p.bets[i]=20;p.stacks[i]=55;
  assert.deepEqual(plain(adapter.view(m,id).actions.filter(a=>a.kind==='raise')),[{kind:'raise',to:75}]);
  p.acted[i]=true;
  assert(!adapter.view(m,id).actions.some(a=>a.kind==='raise'));
  p.acted[i]=false;p.stacks[i]=200;
  assert(adapter.view(m,id).actions.every(a=>a.kind!=='raise'||a.to>=80));
  const view=plain(adapter.view(m,id));
  const other=p.players[(i+1)%p.players.length];
  [m.secret.hands[other][0],m.secret.deck[0]]=[m.secret.deck[0],m.secret.hands[other][0]];
  const after=plain(adapter.view(m,id));
  assert.deepEqual(view,after);
  const choose=v=>plain(w.ArenaBots.strategies.holdem({publicState:v.public,privateState:v.private,
    legalActions:v.actions,difficulty:'normal',persona:'bold',memory:{},random:random(8)}));
  assert.deepEqual(choose(view),choose(after));
  const l=new w.Lobby();l.create('Host');l.prepare('holdem');seat(l,l.me,1);
  l.configureBot(0,'add');
  assert.throws(()=>l.start('holdem'),/1 号席/);
  const bot=l.setup.seats[0];
  l.assign(bot,1,l.me);
  l.setReady(l.me,true,0);
  l.start('holdem');
  assert.equal(l.match.pub.players[0],l.me);
});

test('Holdem runs 500 seeded hands, multi-hand review and short-stack side pots without minting points',t=>{
  const w=world(3403),results=[],reasons={};
  let completed=0,multiHandTables=0;
  for(let table=0;completed<500;table++){
    const count=2+table%7, ids=Array.from({length:count},(_,i)=>'p'+i);
    const m=new w.Holdem(ids),rng=random(44000+table);
    // Equal total with uneven stacks forces at least one short all-in before a round starts.
    if(table%3===0){
      m.pub.phase='review';
      m.pub.stacks=ids.map((_,i)=>i===0?25:i===1?1975:1000);
      m.act(ids[0],{kind:'next-hand'});
    }
    let hands=0;
    for(;hands<12&&completed<500;hands++){
      results.push(sim(w,'holdem',m,{limit:400,rng,invariant:m=>{
        const sum=m.pub.stacks.concat(m.pub.paid).reduce((a,b)=>a+b,0);
        assert.equal(sum,count*1000);
        assert(m.pub.stacks.every(x=>Number.isInteger(x)&&x>=0));
      }}));
      assert.equal(m.pub.phase,'review');
      assert.equal(m.pub.stacks.reduce((a,b)=>a+b,0),count*1000);
      assert(m.pub.results.length>0);
      completed++;
      tally(reasons,Object.keys(m.pub.revealed).length?'showdown':'uncontested');
      assert.throws(()=>m.act(ids[1],{kind:'next-hand'}),/桌主/);
      if(m.pub.stacks.filter(x=>x>0).length<2)break;
      m.act(ids[0],{kind:'next-hand'});
    }
    if(hands>=2)multiHandTables++;
  }
  assert(multiHandTables>30);
  const side=new w.Holdem(['x','y','z']);
  side.pub.phase='review';side.pub.stacks=[25,75,2900];side.act('x',{kind:'next-hand'});
  for(let i=0;i<20&&side.pub.phase==='play';i++){
    const p=side.pub,id=p.players[p.turn],legal=w.ArenaBots.adapters.holdem.view(side,id).actions;
    side.act(id,legal.filter(a=>a.kind==='raise').at(-1)||{kind:'call'});
  }
  assert.equal(side.pub.phase,'review');
  assert.equal(side.pub.community.length,5);
  assert.equal(side.pub.stacks.reduce((a,b)=>a+b,0),3000);
  t.diagnostic(JSON.stringify({seeds:[3403,44000],hands:completed,multiHandTables,holdem:{...summary(results),reasons},exceptions:0}));
});

test('Kingdoms honors fog, rejects unaffordable and allied orders, and skips defeated countries',()=>{
  const w=world(),m=new w.KingdomMatch(['x','y','z']),ada=w.ArenaBots.adapters.kingdoms,p=m.pub;
  const id='x',mine=p.tiles.findIndex(t=>t.owner===0),fog=p.tiles.findIndex((t,j)=>t.owner!==0&&!m.visible(0).has(j));
  assert(fog>=0);
  const b=plain(ada.view(m,id));
  p.tiles[fog].army=[20,3,2];p.tiles[fog].build=[2,2,2,2];m.orders[1]=[{kind:'research',item:0}];
  assert.deepEqual(b,plain(ada.view(m,id)));
  const choose=v=>plain(w.ArenaBots.strategies.kingdoms({publicState:v.public,privateState:v.private,
    legalActions:v.actions,difficulty:'normal',persona:'military',memory:{},random:random(48)}));
  assert.deepEqual(choose(b),choose(ada.view(m,id)));
  assert.equal(b.public.tiles[fog].army,null);
  p.realms[0].gold=0;
  assert(ada.view(m,id).actions.every(a=>!['recruit','build','research'].includes(a.kind)));
  const adj=[mine%8?mine-1:mine+1,mine>=8?mine-8:mine+8].find(j=>p.tiles[j].owner!==0);
  p.tiles[adj].owner=1;p.alliances=[[0,1]];
  assert(!ada.view(m,id).actions.some(a=>a.kind==='march'&&a.from===mine&&a.to===adj));
  p.offers=[{id:'old',from:1,to:0,kind:'trade',expires:0}];
  assert(!ada.view(m,id).actions.some(a=>a.offer==='old'));
  p.realms[0].alive=false;
  assert.equal(ada.turn(m,{x:true},0),null);
});

test('Kingdoms completes 100 seeded strategic games across all table sizes',t=>{
  const w=world(3404),results=[],reasons={},personas=w.ArenaBots.personas.kingdoms;
  assert.equal(personas.length,4);
  for(let i=0;i<100;i++){
    const m=new w.KingdomMatch(Array.from({length:2+i%7},(_,j)=>'p'+j));
    results.push(sim(w,'kingdoms',m,{rng:random(45000+i),limit:810,invariant:m=>{
      assert(m.pub.round<=20);assert(m.orders.every(a=>a.length<=4));
      assert(m.pub.tiles.every(x=>x.army.reduce((a,b)=>a+b,0)<=30&&x.build.every(v=>v>=0&&v<=2)));
      assert(m.pub.realms.every(r=>r.gold>=0&&r.gold<=180&&r.food>=0&&r.food<=180&&r.pop>=0&&r.pop<=90));
      assert.equal(new Set(m.pub.ready).size,m.pub.ready.length);
    }}));
    assert.equal(m.pub.phase,'end');
    reasons[m.pub.result]=(reasons[m.pub.result]||0)+1;
  }
  t.diagnostic(JSON.stringify({seeds:[3404,'45000–45099'],kingdoms:summary(results),reasons,exceptions:0}));
});

test('the V3.4 candidate starts all 15 games with human seats alone',()=>{
  const w=world(),games=w.ctx.BlackmiSDK.games.list();
  assert.equal(games.length,15);
  for(const game of games){
    const l=new w.Lobby();l.create('Host');l.prepare(game.id);seat(l,l.me,0);
    for(let i=1;i<game.minPlayers;i++){
      const id='human-'+i;l.players.push({id,name:'Human '+i,ready:false});seat(l,id,i);
    }
    l.start(game.id);
    assert.equal(l.state.kind,game.id);
    assert.equal(l.state.players.length,game.minPlayers);
    assert(!l.state.bots);
    l.end();
  }
});

test('Gomoku full board completes as a draw and both policies take immediate wins',()=>{
  const w=world(),m=new w.Match('gomoku',['a','b']);
  for(let y=0;y<15;y++)for(let x=0;x<15;x++){
    if(x===14&&y===14)continue;
    const stone=(x+2*y)%4<2?1:2;
    m.pub.board[y*15+x]=stone;m.pub.moves.push([x,y,stone]);
  }
  m.pub.turn=1;
  m.act('b',{kind:'place',x:14,y:14});
  assert.equal(m.pub.phase,'end');assert.equal(m.pub.winner,null);
  for(const difficulty of ['easy','normal']){
    const p=new w.Match('gomoku',['x','y']);
    p.pub.board[0]=p.pub.board[1]=p.pub.board[2]=p.pub.board[3]=1;
    const view=w.ArenaBots.adapters.gomoku.view(p);
    assert.deepEqual(plain(w.ArenaBots.strategies.gomoku({publicState:view.public,
      legalActions:view.actions,difficulty,random:()=>.5})),{kind:'place',x:4,y:0});
  }
});

test('UNO decisions are independent of opposing hand and future draw order',()=>{
  const w=world(108),m=new w.Uno(['x','y','z']),id=m.pub.players[m.pub.turn];
  const other=m.pub.players[(m.pub.turn+1)%3],ada=w.ArenaBots.adapters.uno;
  const before=plain(ada.view(m,id));
  [m.hands[other][0],m.deck[0],m.deck[1]]=[m.deck[0],m.deck[1],m.hands[other][0]];
  const after=plain(ada.view(m,id));
  assert.deepEqual(before,after);
  const decide=v=>plain(w.ArenaBots.strategies.uno({publicState:v.public,privateState:v.private,
    legalActions:v.actions,difficulty:'normal',memory:{},random:random(328)}));
  assert.deepEqual(decide(before),decide(after));
});

test('bot decision faults preserve maintenance, reset projections, and allow a clean rematch',async()=>{
  const w=world(),l=scene(w,'gomoku'),ada=w.ArenaBots.adapters.gomoku;
  const peer=paired(w,l,'Observer');
  let flushes=0;
  peer.local.flush=()=>{flushes++;};
  l.act({kind:'place',x:7,y:7});
  w.ArenaBots.strategies.gomoku=()=>Promise.reject(Error('invalid promise'));
  l.tick();w.advance(1000);l.tick();peer.drain();
  assert.equal(l.state.moves.length,2);
  assert(l.log.some(line=>line.includes('合法默认')));
  l.act({kind:'place',x:1,y:1});
  const prior=ada.view;
  ada.view=()=>{throw Error('adapter view');};
  l.tick();w.advance(1000);l.tick();peer.drain();
  ada.view=prior;
  assert.equal(flushes,4);
  assert.equal(l.match,null);assert.equal(peer.guest.state,null);
  assert.deepEqual(plain(peer.guest.private),{});assert.match(peer.guest.error,/AI 行动异常/);
  l.prepare('gomoku');seat(l,l.me,0);seat(l,peer.guest.me,1);
  l.start('gomoku');peer.drain();assert.equal(peer.guest.state.kind,'gomoku');
});

test('SDK projection errors and player disconnect stop a mixed match without private state leaks',()=>{
  const w=world(3415),l=new w.Lobby();l.create('Host');
  const player=paired(w,l,'Teammate'),observer=paired(w,l,'Spectator');
  const drain=()=>{player.drain();observer.drain();};
  const start=()=>{
    l.prepare('three-kingdoms');seat(l,l.me,0);seat(l,player.guest.me,1);l.fillBots(4);l.start('three-kingdoms');drain();
  };
  start();
  assert.equal(player.guest.private.seat,1);
  assert.deepEqual(plain(observer.guest.private),{});
  assert(observer.guest.state.data.seats.every(x=>!('hand' in x)));
  l.match.rules.publicFor=()=>{throw Error('broken projection');};
  l.act({kind:'set-mode',choice:'fast',seq:l.match.rules.window.seq});
  drain();
  assert.equal(l.match,null);assert.equal(observer.guest.state,null);
  assert.deepEqual(plain(player.guest.private),{});
  assert.equal(Object.keys(l.botManager.active).length,0);
  assert.match(observer.guest.error,/投影或序列化/);
  start();
  player.local.close();drain();
  assert.equal(observer.guest.state.phase,'aborted');
  assert.deepEqual(plain(observer.guest.private),{});
  assert.equal(Object.keys(l.botManager.active).length,0);
});

test('30 simulated minutes keep one pending job, service pings and release room state',t=>{
  const w=world(3410),l=new w.Lobby();l.create('Host');
  const peer=paired(w,l,'Observer');
  const rng=random(3411);
  l.botManager.random=rng;
  let windows=0,flushes=0;
  peer.local.flush=()=>{flushes++;};
  for(let step=0;step<3600;step++){
    if(!l.match||l.idle()){
      l.prepare('uno');seat(l,l.me,0);l.fillBots(8);l.start('uno');windows++;
    }
    w.advance(500);
    const m=l.match,before=m.pub.rev;
    if(m.pub.players[m.pub.turn]===l.me&&m.pub.phase==='play'){
      const view=w.ArenaBots.adapters.uno.view(m,l.me);
      l.action(l.me,w.ArenaBots.strategies.uno({publicState:view.public,privateState:view.private,
        legalActions:view.actions,difficulty:'normal',random:rng}));
    }
    l.tick();
    peer.guest.tick();
    peer.drain();
    assert(m.pub.rev-before<=3);
    assert(l.log.length<=30);
    assert(l.botManager.pending===null||Object.keys(l.botManager.pending).length===2);
    // Do not retain the wire fixture's recorded traffic during a soak.
    peer.received.length=0;
  }
  assert(windows>=2);assert.equal(flushes,3600);
  l.leave();assert(!l.match&&!l.botManager.pending&&l.links.length===0);
  assert.equal(Object.keys(l.botManager.active).length,0);
  t.diagnostic(JSON.stringify({virtualMinutes:30,intervals:3600,flushes,rooms:windows,seed:3410}));
});

test('reports host pipeline timing and complete snapshot sizes with AI off and on',t=>{
  const w=world(3412),rows={};
  const q=(items,p)=>+(items.sort((a,b)=>a-b)[Math.floor(items.length*p)]||0).toFixed(3);
  for(const kind of ['gomoku','uno','three-kingdoms','holdem','kingdoms']){
    const n=kind==='gomoku'?2:8;
    const off=new w.Lobby();off.create('Host');off.prepare(kind);seat(off,off.me,0);
    for(let i=1;i<n;i++){const id='real-'+i;off.players.push({id,name:'Human '+i,ready:false});seat(off,id,i);}
    off.start(kind);
    const on=scene(w,kind,n),ada=w.ArenaBots.adapters[kind],strategy=w.ArenaBots.strategies[kind];
    if(kind==='three-kingdoms')on.act({kind:'set-mode',choice:'fast',seq:on.match.rules.window.seq});
    const limits={off:[],policy:[],pipeline:[]};
    let steps=0,size=0,chars=0;
    for(let i=0;i<200&&on.match&&on.match.pub.phase==='play';i++){
      let stamp=performance.now();off.tick();limits.off.push(performance.now()-stamp);
      const m=on.match,turn=ada.turn(m,on.botManager.active,on.botManager.cursor);
      if(turn){
        const pending={};on.botManager.pending=pending;
        on.botManager.tick(w.now());
        if(on.botManager.pending)on.botManager.pending.at=w.now();
        w.ArenaBots.strategies[kind]=args=>{
          const start=performance.now();try{return strategy(args);}finally{limits.policy.push(performance.now()-start);}
        };
        stamp=performance.now();
        try{on.tick();limits.pipeline.push(performance.now()-stamp);}finally{w.ArenaBots.strategies[kind]=strategy;}
        steps++;
      } else {
        const fake={[on.me]:true},human=ada.turn(m,fake,0);
        if(!human)break;
        const v=ada.view(m,on.me),act=strategy({publicState:v.public,privateState:v.private,
          legalActions:v.actions,difficulty:'normal',memory:{},random:random(i+1)});
        on.action(on.me,act||v.fallback||v.actions[0]);
      }
      if(!on.match)break;
      for(const id of [null,on.me,turn&&turn.id].filter((id,i)=>i!==2||id)){
        const data=JSON.stringify(on.snapshot(id,w.now(),true));
        size=Math.max(size,Buffer.byteLength(data));
        chars=Math.max(chars,data.length);
      }
      w.advance(500);
    }
    assert(steps>0&&limits.policy.length>0);
    assert(on.match,'failure in '+kind+' '+on.error);
    assert(chars<120000);
    rows[kind]={samples:limits.policy.length,aiOffIdleP95:q(limits.off,.95),policyP95:q(limits.policy,.95),
      hostDecisionP95:q(limits.pipeline,.95),hostDecisionMax:q(limits.pipeline,.999),snapshotMaxBytes:size,snapshotMaxChars:chars};
  }
  t.diagnostic(JSON.stringify({seed:3412,timing:'ms',rows}));
});

test('candidate is deterministic and transport, pairing, chat and AIGC remain exact',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert(fs.readFileSync(build(path.join(dir,'built.html'))).equals(fs.readFileSync(release)),'candidate differs from a clean build');
  const before=gameScript(base),after=gameScript(release),historical=gameScript(rc1);
  const frozen=spawnSync('git',['diff','--exit-code','7c4756462aa872179e5ceace9655d2613434f1a9','--',
    'client',':(exclude)client/Blackmi_OS_V3.4_AI_Arena_RC2.html','sdk/blackmi-sdk.d.ts','sdk/bundle.cjs',
    'sdk/bots/manager.js','sdk/bots/seats.js','sdk/bots/uno.js','sdk/bots/three-kingdoms.js','sdk/bots/holdem.js'],
    {cwd:path.join(__dirname,'..'),encoding:'utf8'});
  if(frozen.status!==128&&frozen.error?.code!=='ENOENT')assert.equal(frozen.status,0,frozen.stderr||frozen.stdout);
  function span(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i+1);assert(i>=0&&j>i);return s.slice(i,j);}
  for(const [a,b] of [['class KingdomMatch{','// Bundled SDK round games'],['class Lobby {','var ArenaBots = (function()'],
    ['var ArenaBots = (function()','  function turn(m,bots,key,deadline)']]){
    assert.equal(span(historical,a,b),span(after,a,b));
  }
  for(const [a,b] of [['class Link {','// V2.8 application-layer games'],[' async offer(){check(this.role',' setSnapshot(']]){
    assert.equal(span(before,a,b),span(after,a,b));
  }
  assert.equal(scripts(base)[0],scripts(release)[0]);
  assert.equal(scripts(base)[2],scripts(release)[2]);
  assert.deepEqual(scripts(release).slice(-5),scripts(base).slice(-5));
  assert.doesNotMatch(fs.readFileSync(release,'utf8'),/<script\b[^>]*\bsrc\s*=|<link\b[^>]*rel\s*=\s*['"]?stylesheet/i);
  for(const [a,b] of [['function corePost(','function toast('],['/* 3.1.2 Notice-safe','</style>']]){
    assert.equal(span(fs.readFileSync(base,'utf8'),a,b),span(fs.readFileSync(release,'utf8'),a,b));
  }
  for(const file of [base,release])assert.match(fs.readFileSync(file,'utf8'),/<meta name="AIGC"/);
  assert.equal(fs.readFileSync(base,'utf8').match(/<meta name="AIGC"[^>]*>/)[0],fs.readFileSync(release,'utf8').match(/<meta name="AIGC"[^>]*>/)[0]);
});

function kingdomCapital(w){
  const m=new w.KingdomMatch(['x','y','z']),p=m.pub;
  const cap=p.tiles.findIndex(t=>t.cap===0);
  const near=[cap%8?cap-1:-1,cap%8<7?cap+1:-1,cap>=8?cap-8:-1,cap<40?cap+8:-1].filter(j=>j>=0);
  return {m,p,cap,home:near.find(j=>p.tiles[j].owner===0),border:near.find(j=>p.tiles[j].owner!==0)};
}
function policyInput(view,persona,memory={},rng=()=>.5){
  return {publicState:plain(view.public),privateState:plain(view.private),legalActions:plain(view.actions),
    difficulty:'normal',persona,memory,random:rng};
}

test('Kingdoms shadow prevents the RC1 four-recruit capital failure',()=>{
  function run(w){
    const {m,p,cap,border}=kingdomCapital(w),ada=w.ArenaBots.adapters.kingdoms;
    p.tiles[cap].army=[23,2,2];p.tiles[cap].build[3]=2;
    p.tiles[border].owner=1;p.tiles[border].army=[22,4,4];
    p.tiles.forEach((t,i)=>{if(i!==cap&&t.owner===0){t.army=[26,2,2];t.build=[2,2,1,2];}});
    Object.assign(p.realms[0],{gold:160,food:150,pop:60,tech:[3,3,3]});
    const orders=[];
    for(let i=0;i<5;i++){
      const a=w.ArenaBots.strategies.kingdoms(policyInput(ada.view(m,'x'),'defense'));
      if(a.kind==='ready')break;
      orders.push(a);m.act('x',a);
    }
    let failed=0,executed=0;
    for(const a of orders)if(a.kind==='recruit'&&a.from===cap){
      try{m.execute(0,a);executed++;}catch(e){assert.match(e.message,/部队已满/);failed++;}
    }
    return {failed,executed,orders};
  }
  const historical=run(world(1,rc1)),candidate=run(world(1));
  assert.equal(historical.orders.length,4);
  assert.equal(historical.failed,3);
  assert.equal(candidate.executed,1);
  assert.equal(candidate.failed,0);
});

test('Kingdoms shadows costs, battalion capacity and build/research/recruit before moving',()=>{
  const w=world(),{m,p,cap,home}=kingdomCapital(w),ada=w.ArenaBots.adapters.kingdoms;
  const {project}=w.kingdomPlan;
  const at=(kind,args)=>({kind,round:p.round,...args});
  p.tiles[cap].army=[21,3,3];p.tiles[cap].build=[1,1,0,1];
  p.tiles[home].army=[24,1,1];
  Object.assign(p.realms[0],{gold:40,food:30,pop:10,tech:[0,0,0]});
  const buildBarracks=at('build',{from:cap,item:2});
  const infantry=at('recruit',{from:cap,unit:0});
  const science=at('research',{item:1});
  const march=at('march',{from:home,to:cap,mode:'half'});
  const view=()=>ada.view(m,'x');
  const before=plain(p);
  assert(view().actions.some(a=>a.kind==='build'&&a.from===cap&&a.item===2));
  for(const a of [buildBarracks,science,infantry])m.act('x',a);
  const shadow=project(view().public,0,view().private.orders);
  assert.deepEqual(plain(shadow.realm),{gold:22,food:22,pop:8,tech:[0,1,0]});
  assert.equal(shadow.tile(cap).army.reduce((a,b)=>a+b),30);
  assert.equal(shadow.tile(cap).build[2],1);
  assert(!view().actions.some(a=>a.kind==='recruit'&&a.from===cap));
  assert(!view().actions.some(a=>a.kind===march.kind&&a.from===home&&a.to===cap));
  assert.deepEqual(plain(p),before);
  for(const a of m.orders[0])m.execute(0,a);
  assert.deepEqual(plain(p.tiles[cap]),plain(shadow.tile(cap)));
  for(const [k,value] of Object.entries(shadow.realm))assert.deepEqual(plain(p.realms[0][k]),plain(value));
});

test('Kingdoms rejects the second transfer and economy orders that invalidate a planned transfer',()=>{
  const w=world(),{m,p,cap,home,border}=kingdomCapital(w),ada=w.ArenaBots.adapters.kingdoms;
  p.tiles[cap].owner=p.tiles[home].owner=p.tiles[border].owner=0;
  p.tiles[cap].army=[20,0,0];p.tiles[home].army=[19,0,0];p.tiles[border].army=[14,0,0];
  const a=(kind,args)=>({kind,round:p.round,...args});
  m.act('x',a('march',{from:home,to:cap,mode:'half'}));
  const actions=ada.view(m,'x').actions;
  assert(!actions.some(o=>o.kind==='march'&&o.from===home));
  assert(!actions.some(o=>o.kind==='march'&&o.from===border&&o.to===cap));
  assert(!actions.some(o=>o.kind==='recruit'&&o.from===cap&&o.unit===0));
  assert(!actions.some(o=>o.kind==='recruit'&&o.from===home&&o.unit===0));
  const state=w.kingdomPlan.project(ada.view(m,'x').public,0,m.orders[0]);
  assert.equal(state.tile(cap).army[0],29);
  assert.equal(state.tile(home).army[0],10);
  // Poor initial reserves distinguish planned expenditure from the original round's resources.
  p.realms[0].gold=8;p.realms[0].food=8;
  m.orders[0]=[];m.act('x',a('research',{item:0}));
  assert(!ada.view(m,'x').actions.some(o=>['recruit','build','research'].includes(o.kind)));
  m.orders[0]=[];
  p.offers=[{id:'trade',kind:'trade',from:0,to:1,expires:p.round+1}];
  assert(w.kingdomPlan.project(ada.view(m,'x').public,0,[]).realm.gold===2);
  assert(!ada.view(m,'x').actions.some(o=>['recruit','build','research'].includes(o.kind)));
});

test('Kingdoms forecasts accepted alliances before marching and remembers only bounded visible strategy',()=>{
  const w=world(),{m,p,cap,border}=kingdomCapital(w),ada=w.ArenaBots.adapters.kingdoms;
  p.tiles[border].owner=1;p.tiles[border].army=[5,1,1];
  p.offers=[{id:'ally',kind:'ally',to:0,from:1,expires:p.round+1}];
  const march={kind:'march',from:cap,to:border,mode:'half',round:p.round},accept={kind:'accept',offer:'ally',round:p.round};
  const view=()=>ada.view(m,'x');
  assert(view().actions.some(a=>a.kind==='accept'));
  m.act('x',march);
  assert(!view().actions.some(a=>a.kind==='accept'));
  m.orders[0]=[];m.act('x',accept);
  assert(!view().actions.some(a=>a.kind==='march'&&a.to===border));
  const memory=ada.observe(view().public,{});
  assert.deepEqual(Object.keys(memory).sort(),['allies','capital','danger','focus','pressure','round','route']);
  const focus=memory.focus;
  assert.equal(ada.observe(view().public,memory),memory);
  p.round++;p.tiles[focus].owner=0;p.realms[0].food=6;
  const second=ada.observe(view().public,memory);
  assert.notEqual(second.focus,focus);
  assert.equal(second.pressure,'food');
  assert.equal(second.round,p.round);
});

test('Kingdoms RC2 independent seeds report route, execution failures and player-normalized personality behaviors',t=>{
  const results=[],reasons={},traits={},errors={};
  let issued=0,executed=0,failed=0;
  for(let game=0;game<100;game++){
    const w=world(0x34620000+game),m=new w.KingdomMatch(Array.from({length:2+game%7},(_,i)=>'country-'+i));
    const personas=w.ArenaBots.personas.kingdoms,profileBySeat=m.pub.players.map((_,i)=>personas[(game+i)%4]);
    const engine=m.execute.bind(m);
    const increments=profileBySeat.map(persona=>{
      const stat=traits[persona]||(traits[persona]={seats:0,turns:0,attack:0,transfer:0,barracks:0,wall:0,economy:0,diplomacy:0});
      stat.seats++;return stat;
    });
    m.execute=(i,a)=>{
      const stat=increments[i],friendly=a.kind==='march'&&m.pub.tiles[a.to].owner===i;
      try{engine(i,a);executed++;}catch(e){failed++;tally(errors,a.kind+' '+e.message);throw e;}
      if(a.kind==='march')stat[friendly?'transfer':'attack']++;
      if(a.kind==='build'&&a.item===2)stat.barracks++;
      if(a.kind==='build'&&a.item===3)stat.wall++;
      if(a.kind==='build'&&a.item<=1||a.kind==='research'&&a.item!==1)stat.economy++;
      if(['trade','ally','accept','break'].includes(a.kind))stat.diplomacy++;
    };
    const ada=w.ArenaBots.adapters.kingdoms;
    results.push(sim(w,'kingdoms',m,{limit:810,rng:random(0x34630000+game),
      profiles:m.pub.players.map((_,i)=>({difficulty:'normal',persona:profileBySeat[i]})),
      onAction(m,turn,action){
        if(action.kind==='ready')increments[turn.index].turns++;
        else issued++;
        assert(ada.legal(m,turn.id,action));
      }
    }));
    assert.equal(m.pub.phase,'end');
    tally(reasons,m.pub.result);
  }
  assert.equal(executed+failed,issued);
  assert((failed/issued)<.02,JSON.stringify(errors));
  const rate=(persona,metric)=>traits[persona][metric]/traits[persona].turns;
  assert(rate('military','attack')>rate('economy','attack'));
  assert(rate('defense','wall')>rate('military','wall'));
  assert(rate('diplomacy','diplomacy')>rate('military','diplomacy'));
  assert(rate('economy','economy')>rate('military','economy'));
  assert(Object.values(traits).reduce((n,x)=>n+x.barracks,0)>0);
  t.diagnostic(JSON.stringify({ruleSeeds:'0x34620000–0x34620063',policySeeds:'0x34630000–0x34630063',
    kingdom:summary(results),reasons,issued,executed,failed,errors,traits}));
});

const gomokuAxes=[[1,0],[0,1],[1,1],[1,-1]];
function classicGomoku({publicState:p,legalActions:actions,random:rng}){
  function shape(a,stone){
    let score=0;
    for(const [dx,dy] of gomokuAxes){
      let length=1,open=0;
      for(const side of [-1,1]){
        let x=a.x+dx*side,y=a.y+dy*side;
        for(;x>=0&&x<15&&y>=0&&y<15&&p.board[y*15+x]===stone;x+=dx*side,y+=dy*side)length++;
        if(x>=0&&x<15&&y>=0&&y<15&&p.board[y*15+x]===0)open++;
      }
      if(length>=5)return 100000;
      if(open)score+=open*[0,1,9,55,320][length];
    }
    return score;
  }
  const mine=p.turn+1,other=3-mine;
  let best=actions[0],value=-Infinity;
  for(const a of actions){
    const attack=shape(a,mine),defense=shape(a,other);
    if(attack>=100000)return a;
    const score=attack+defense*1.02+(14-Math.abs(a.x-7)-Math.abs(a.y-7))*.08+rng()*.05;
    if(score>value){value=score;best=a;}
  }
  return best;
}
function gomokuFixture(w,stones){
  const m=new w.Match('gomoku',['black','white']);
  for(const [x,y,color] of stones){m.pub.board[y*15+x]=color||1;m.pub.moves.push([x,y,color||1]);}
  return m;
}
function gomokuPick(w,m,difficulty='normal',rng=()=>.5){
  return w.ArenaBots.strategies.gomoku({publicState:m.pub,legalActions:w.ArenaBots.adapters.gomoku.view(m).actions,
    difficulty,random:rng});
}
function place(x,y){return {kind:'place',x,y};}

test('Gomoku threat detection builds two open threes and turns a closed four into a four-three win',()=>{
  const w=world(1,release,{now:()=>0});
  const fork=gomokuFixture(w,[[6,7],[8,7],[7,6],[7,8],[1,1,2],[13,4,2]]);
  assert.deepEqual(plain(gomokuPick(w,fork)),place(7,7));
  const stones=[[4,7],[5,7],[6,7],[3,7,2],[7,5],[7,6],[0,0,2],[13,12,2]];
  const m=gomokuFixture(w,stones);
  const move=gomokuPick(w,m);
  assert.deepEqual(plain(move),place(7,7));
  m.act('black',move);
  assert.deepEqual(plain(gomokuPick(w,m)),place(8,7));
  m.act('white',place(8,7));
  m.act('black',gomokuPick(w,m));
  const winEnds=[4,9];
  assert(winEnds.some(y=>m.pub.board[y*15+7]===0));
  for(const y of winEnds){
    const replay=gomokuFixture(w,m.pub.moves);
    replay.pub.turn=1;
    replay.act('white',place(7,y));
    replay.act('black',gomokuPick(w,replay));
    assert.equal(replay.pub.winner,'black');
  }
});

test('Gomoku finds a forcing sequence of two closed fours before an open four',()=>{
  const w=world(1,release,{now:()=>0});
  const stones=[[4,7],[5,7],[6,7],[3,7,2],[7,5],[7,6],[7,4,2],[5,8],[6,8],[1,1,2],[4,9,2],[9,4,2]];
  const m=gomokuFixture(w,stones);
  for(const [black,white] of [[place(7,7),place(8,7)],[place(7,8),place(7,9)]]){
    assert.deepEqual(plain(gomokuPick(w,m)),black);
    m.act('black',black);
    assert.deepEqual(plain(gomokuPick(w,m)),white);
    m.act('white',white);
  }
  m.act('black',gomokuPick(w,m));
  const follow=[place(4,8),place(9,8)].find(a=>!m.pub.board[a.y*15+a.x]);
  assert(follow);
  m.act('white',follow);
  m.act('black',gomokuPick(w,m));
  assert.equal(m.pub.winner,'black');
});

test('Gomoku exhausted time keeps legal fallback and checks distant mandatory defenses',()=>{
  let checks=0;
  const w=world(1,release,{now:()=>checks++?5:0});
  const edge=gomokuFixture(w,[[10,14,2],[11,14,2],[12,14,2],[13,14,2],[9,14,1]]);
  assert.deepEqual(plain(gomokuPick(w,edge)),place(14,14));
  const quiet=gomokuFixture(w,[[7,7],[8,8,2]]);
  const fallback=gomokuPick(w,quiet);
  assert(w.ArenaBots.adapters.gomoku.view(quiet).actions.some(a=>a.x===fallback.x&&a.y===fallback.y));
  assert.notDeepEqual(plain(fallback),place(7,7));
});

test('Gomoku normal and easy use different choices in a symmetric real position',()=>{
  const w=world(1,release,{now:()=>0}),m=gomokuFixture(w,[[7,7]]);
  m.pub.turn=1;
  assert.notDeepEqual(plain(gomokuPick(w,m,'easy',()=>.999)),plain(gomokuPick(w,m,'normal')));
});

test('Gomoku RC2 plays RC1 and a simple independent evaluator with matched openings and swapped colors',t=>{
  const candidate=world(346401,release,{now:()=>0});
  const historical=world(346401,rc1,{now:()=>0});
  const policy=candidate.ArenaBots.strategies.gomoku;
  const opponents={rc1:historical.ArenaBots.strategies.gomoku,classic:classicGomoku};
  const rows={};
  for(const [name,opponent] of Object.entries(opponents)){
    const results={black:{win:0,draw:0,loss:0},white:{win:0,draw:0,loss:0}};
    let decisions=0;
    for(let seed=0;seed<12;seed++)for(const color of [0,1]){
      const m=new candidate.Match('gomoku',['black','white']),rng=random(346500+seed);
      const offset=seed%8;
      const openings=[[6,6],[7,6],[8,6],[6,7],[8,7],[6,8],[7,8],[8,8]];
      m.act('black',place(7,7));m.act('white',place(...openings[offset]));
      if(seed>=8)m.act('black',place(...openings[(offset+3)%8]));
      const adapter=candidate.ArenaBots.adapters.gomoku;
      while(m.pub.phase==='play'){
        const id=m.pub.players[m.pub.turn];
        const input=policyInput(adapter.view(m,id),null,{},rng);
        m.act(id,(m.pub.turn===color?policy:opponent)(input));
        assert(m.pub.moves.length<=225);
        decisions++;
      }
      const key=color===0?'black':'white';
      tally(results[key],m.pub.winner===null?'draw':m.pub.winner===key?'win':'loss');
    }
    assert(results.black.win+results.white.win>results.black.loss+results.white.loss);
    rows[name]={...results,decisions};
  }
  t.diagnostic(JSON.stringify({rulesSeed:346401,policySeeds:'346500–346511',clock:'fixed; node bound only',rows}));
});
