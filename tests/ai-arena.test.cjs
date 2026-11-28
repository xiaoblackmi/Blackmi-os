const assert=require('node:assert/strict');
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
  vm.runInContext(gameScript(file).replace('})(globalThis);','globalThis.Test={Lobby,Match,Uno,Holdem,KingdomMatch,SdkRoundMatch,ArenaBots,unoCard,sdkGames};\n})(globalThis);'),ctx);
  for(const code of scripts(file).slice(-5))vm.runInContext(code,ctx);
  return {...ctx.Test,ctx,now:()=>time,advance:ms=>{time+=ms;}};
}
function paired(w,host,name){
  const guest=new w.Lobby(),received=[],messages=[];
  const local={token:'fixture-token',last:w.now(),opened:true,flush(){},send(m){received.push(plain(m));messages.push(()=>guest.receive(remote,plain(m)));return true;},
    close(){this.dead=true;host.drop(this,'closed');}};
  const remote={token:local.token,last:w.now(),opened:true,flush(){},send(m){messages.push(()=>host.receive(local,plain(m)));return true;}};
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
  for(;step<(options.limit||4000)&&m.pub.phase==='play';step++){
    const turn=ada.turn(m,profile,cursor);
    if(!turn){if(options.human&&options.human(m,w))continue;break;}
    const view=ada.view(m,turn.id),t=performance.now();
    const action=policy({publicState:plain(view.public),privateState:plain(view.private),legalActions:plain(view.actions),
      difficulty:profile[turn.id].difficulty,persona:profile[turn.id].persona,memory:{},random:rng});
    times.push(performance.now()-t);
    const valid=view.actions.find(x=>JSON.stringify(x)===JSON.stringify(action));
    assert(valid,'illegal '+kind+' '+JSON.stringify(action));
    m.act(turn.id,valid);
    cursor=turn.index+1;
    if(options.invariant)options.invariant(m);
  }
  outcomes[m.pub.phase]=1;
  return {step,times,outcomes};
}
function summary(results){
  const times=results.flatMap(x=>x.times).sort((a,b)=>a-b),outcomes={};
  for(const result of results)for(const k of Object.keys(result.outcomes))outcomes[k]=(outcomes[k]||0)+result.outcomes[k];
  return {decisions:results.reduce((sum,x)=>sum+x.step,0),outcomes,p50:+times[Math.floor(times.length*.5)].toFixed(3),
    p95:+times[Math.floor(times.length*.95)].toFixed(3),max:+times.at(-1).toFixed(3)};
}

test('200 seeded Gomoku games and 200 seeded UNO games terminate with legal moves',t=>{
  const w=world(3401),gomoku=[],uno=[];
  for(let i=0;i<200;i++){
    const a=new w.Match('gomoku',['black','white']),b=new w.Uno(Array.from({length:2+i%7},(_,j)=>'seat'+j));
    gomoku.push(sim(w,'gomoku',a,{rng:random(41000+i),limit:226}));
    assert.equal(a.pub.phase,'end');
    assert.equal(new Set(a.pub.moves.map(x=>x.slice(0,2).join(','))).size,a.pub.moves.length);
    uno.push(sim(w,'uno',b,{rng:random(42000+i),limit:2000,invariant:m=>{
      const ids=[...m.deck,...m.pile,...Object.values(m.hands).flat()];
      assert.equal(ids.length,108);
      assert.equal(new Set(ids).size,108);
    }}));
    assert.equal(b.pub.phase,'end');
  }
  t.diagnostic(JSON.stringify({seeds:[3401,'41000–41199','42000–42199'],gomoku:summary(gomoku),uno:summary(uno)}));
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
  const w=world(3402),results=[];
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
  }
  t.diagnostic(JSON.stringify({seeds:[3402,'43000–43199'],threeKingdoms:summary(results)}));
});

test('candidate is deterministic and transport, pairing, chat and AIGC remain exact',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.deepEqual(fs.readFileSync(build(path.join(dir,'built.html'))),fs.readFileSync(release));
  const before=gameScript(base),after=gameScript(release);
  function span(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i+1);assert(i>=0&&j>i);return s.slice(i,j);}
  for(const [a,b] of [['class Link {','// V2.8 application-layer games'],[' async offer(){check(this.role',' setSnapshot(']]){
    assert.equal(span(before,a,b),span(after,a,b));
  }
  assert.equal(scripts(base)[0],scripts(release)[0]);
  for(const [a,b] of [['function corePost(','function toast('],['/* 3.1.2 Notice-safe','</style>']]){
    assert.equal(span(fs.readFileSync(base,'utf8'),a,b),span(fs.readFileSync(release,'utf8'),a,b));
  }
  for(const file of [base,release])assert.match(fs.readFileSync(file,'utf8'),/<meta name="AIGC"/);
  assert.equal(fs.readFileSync(base,'utf8').match(/<meta name="AIGC"[^>]*>/)[0],fs.readFileSync(release,'utf8').match(/<meta name="AIGC"[^>]*>/)[0]);
});
