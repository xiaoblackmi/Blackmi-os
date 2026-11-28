const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const {test}=require('node:test');
const {build,base,release}=require('../sdk/bots/build.cjs');

function random(seed){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
function scripts(file){return Array.from(fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),x=>x[1]);}
function gameScript(file){return scripts(file).find(x=>x.includes('class Lobby {'));}
function plain(x){return JSON.parse(JSON.stringify(x));}
function world(seed=1,file=release){
  let time=100000;
  const rng=random(seed), ctx=vm.createContext({performance,console,document:{readyState:'loading'},
    Date:class extends Date{static now(){return time;}},
    crypto:{getRandomValues(a){for(let i=0;i<a.length;i++)a[i]=rng()*4294967296;return a;}},
    setInterval:()=>0,BlackmiApps:{register(){},close(){}}});
  vm.runInContext(gameScript(file).replace('})(globalThis);','globalThis.Test={Lobby,Match,Uno,Holdem,KingdomMatch,SdkRoundMatch,ArenaBots:typeof ArenaBots==="undefined"?null:ArenaBots,unoCard,sdkGames};\n})(globalThis);'),ctx);
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
  const profile=Object.fromEntries(m.pub.players.map((id,i)=>[id,{difficulty:i%2?'normal':'easy',
    persona:(w.ArenaBots.personas[kind]||[])[i%((w.ArenaBots.personas[kind]||[]).length)]||''}]));
  const times=[],outcomes={};
  let step=0,cursor=0;
  const memories=new Map();
  for(;step<(options.limit||4000)&&m.pub.phase==='play';step++){
    const turn=ada.turn(m,profile,cursor);
    if(!turn){if(options.human&&options.human(m,w))continue;break;}
    const view=ada.view(m,turn.id),t=performance.now();
    const action=policy({publicState:plain(view.public),privateState:plain(view.private),legalActions:plain(view.actions),
      difficulty:profile[turn.id].difficulty,persona:profile[turn.id].persona,memory:memories.get(turn.id)||{},random:rng});
    times.push(performance.now()-t);
    const valid=view.actions.find(x=>JSON.stringify(x)===JSON.stringify(action));
    assert(valid,'illegal '+kind+' '+JSON.stringify(action));
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
  const before=gameScript(base),after=gameScript(release);
  const frozen=spawnSync('git',['diff','--exit-code','c1781b7faf6d8b9f2152612dfab0291729a2bd1f','--',
    'client',':(exclude)client/Blackmi_OS_V3.4_AI_Arena.html','sdk/blackmi-sdk.d.ts','sdk/bundle.cjs'],
    {cwd:path.join(__dirname,'..'),encoding:'utf8'});
  if(frozen.status!==128&&frozen.error?.code!=='ENOENT')assert.equal(frozen.status,0,frozen.stderr||frozen.stdout);
  function span(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i+1);assert(i>=0&&j>i);return s.slice(i,j);}
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
