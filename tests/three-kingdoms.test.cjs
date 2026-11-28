const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const { build, modules, release } = require('../games/three-kingdoms/build.cjs');

const raw = file => fs.readFileSync(file,'utf8');
const source = modules.map(raw);
const plain = value => JSON.parse(JSON.stringify(value));
const ruleWorld = vm.createContext({crypto:webcrypto});
for (const code of source.slice(0,3)) vm.runInContext(code,ruleWorld);
const game = ruleWorld.BlackmiThreeKingdoms;
const basePath = path.join(__dirname,'../client/Blackmi_OS_V3.2.2_DeveloperSDK.html');

function seeded(seed) {
  return () => ((seed = (Math.imul(seed,1664525) + 1013904223) >>> 0) / 4294967296);
}

function match(count = 4, seed = 1) {
  let time = 1000;
  const ids = Array.from({length:count}, (_,i) => 'seat-' + i);
  const finished = [];
  const random = seeded(seed);
  const engine = game.create({players:ids,finish:id => finished.push(id)}, {clock:() => time,random});
  return {engine, ids, finished, random,
    expire() { time = engine.window.deadline; return engine.tick(time); },
    now() { return time; }};
}

function board(heroes = [], count = 4) {
  const result = match(count);
  const m = result.engine;
  m.seats.forEach((seat,i) => {
    seat.hero = heroes[i] || 'zhao';
    seat.role = game.roleSet(count)[i === 0 ? 0 : i === 1 ? 2 : i === 2 ? 3 : i === 3 ? 1 : i];
    seat.hp = seat.max = i === 0 ? 5 : 4;
    seat.hand.length = 0;
    seat.delay.length = 0;
    seat.power = 0;
    seat.used = Object.create(null);
    seat.ward = false;
    for (const slot of Object.keys(seat.gear)) seat.gear[slot] = null;
  });
  m.pile = Array.from(game.deck, card => card.id);
  m.discard = [];
  m.jobs = [];
  m.events = [];
  m.window = null;
  m.begin(0);
  m.window = null;
  m.jobs = [];
  m.pile = Array.from(game.deck, card => card.id);
  m.phase = 'play';
  m.open('play',0);
  return result;
}

function extract(m, key, predicate = () => true) {
  const card = game.deck.find(card => card.key === key && predicate(card) && m.pile.includes(card.id));
  assert(card, key);
  m.pile.splice(m.pile.indexOf(card.id),1);
  return card.id;
}

function deal(m,seat,key,predicate) {
  const card = extract(m,key,predicate);
  m.seats[seat].hand.push(card);
  return card;
}

function act(m,kind,fields = {}) {
  const w = m.window;
  m.act(m.seats[w.seat].id,{kind,...fields,seq:w.seq});
}

function restartTurn(m, seat) {
  m.window = null;
  m.jobs.length = 0;
  m.begin(seat);
  m.pump();
}

function zones(m) {
  const result = [...m.pile,...m.discard];
  for (const p of m.seats) result.push(...p.hand,...p.delay,...Object.values(p.gear).filter(x => x !== null));
  if (m.window && m.window.order !== undefined) result.push(m.window.order);
  if (m.window && m.window.look) result.push(...m.window.look);
  return result;
}

function verifyInvariants(m,now) {
  const cards = zones(m);
  assert.equal(cards.length,108);
  assert.equal(new Set(cards).size,108);
  assert(cards.every(id => Number.isInteger(id) && id >= 0 && id < 108));
  assert(m.turn <= m.turnCap);
  assert(m.seats.every(p => Number.isInteger(p.hp) && p.hp <= p.max && p.hp >= 0 &&
    (p.alive || p.hp === 0 && p.hand.length === 0) && p.power >= 0 && p.power <= 3));
  if (m.window) {
    assert(m.window.deadline > now);
    assert(m.seats[m.window.seat].alive);
    assert(m.options(m.window.seat).length);
  }
}

test('4–8 roles, unique heroes, lord opens, and court/rebel/rogue outcomes', () => {
  const counts = [[1,1,1,1],[1,1,2,1],[1,1,3,1],[1,2,3,1],[1,2,4,1]];
  for (let n = 4; n <= 8; n++) {
    const {engine:m} = match(n,n + 42);
    const roles = ['lord','ally','rebel','rogue'];
    assert.deepEqual(roles.map(role => m.seats.filter(p => p.role === role).length),counts[n-4]);
    assert.equal(new Set(m.seats.map(p => p.hero)).size,n);
    assert.equal(m.seats[m.active].role,'lord');
    assert.equal(game.winner(m.seats),null);
    const faction = living => game.winner(m.seats.map(seat => ({...seat,alive:living.includes(seat.role)})));
    assert.equal(faction(['lord','ally']),'court');
    assert.equal(faction(['rogue']),'rogue');
    assert.equal(faction(['rogue','rebel']),'rebel');
    assert.equal(faction(['ally','rogue']),'rebel');
    const visible = m.publicFor(null);
    assert.equal(visible.seats.filter(seat => seat.role !== null).length,1);
    assert(!('hand' in visible.seats[0]));
    assert.deepEqual(plain(m.privateFor('spectator')),{});
    for (const seat of m.seats) {
      const view = m.privateFor(seat.id);
      assert.equal(view.role,seat.role);
      assert.deepEqual(plain(view.hand),plain(seat.hand));
      assert(!('pile' in view));
    }
  }
});

test('all 17 card types account for the 108 unique physical cards', async t => {
  assert.equal(game.deck.length,108);
  assert.equal(Object.keys(game.cards).length,17);
  for (const key of Object.keys(game.cards)) {
    assert.equal(game.deck.filter(c => c.key === key).length,game.cards[key].count);
  }
  await t.test('thrust, guard, feint and remedy', () => {
    const {engine:m} = board(['liu','lu']);
    const heal = deal(m,0,'remedy'), strike = deal(m,0,'thrust'), feint = deal(m,0,'feint');
    const guard = deal(m,1,'guard');
    m.seats[0].hp--;
    act(m,'play',{card:heal});
    assert.equal(m.seats[0].hp,5);
    act(m,'play',{card:strike,target:1});
    assert.equal(m.window.type,'guard');
    act(m,'respond',{card:guard});
    assert.equal(m.seats[1].hp,4);
    assert.equal(m.seats[1].power,1);
    assert(!m.options(0).some(a => a.card === feint && a.kind === 'play'));
    m.seats[0].power = 2;
    act(m,'command',{choice:'march'});
    act(m,'play',{card:feint,target:1});
    act(m,'yield');
    assert.equal(m.seats[1].hp,4);
    assert.equal(m.seats[1].power,0);
  });
  await t.test('muster, shatter, forage, rampart', () => {
    const {engine:m} = board(['liu','lu']);
    const muster = deal(m,0,'muster'), shatter = deal(m,0,'shatter');
    const forage = deal(m,0,'forage'), rampart = deal(m,0,'rampart');
    const stolen = deal(m,1,'guard');
    const blade = extract(m,'blade');
    m.seats[1].gear.weapon = blade;
    act(m,'play',{card:muster});
    assert.equal(m.seats[0].hand.length,5);
    act(m,'play',{card:shatter,target:1});
    assert.equal(m.seats[1].gear.weapon,null);
    assert(m.discard.includes(blade));
    act(m,'play',{card:forage,target:1});
    assert(m.seats[0].hand.includes(stolen));
    act(m,'play',{card:rampart,target:1});
    assert(m.seats[1].ward);
    m.damage(1,0,false);
    assert.equal(m.seats[1].hp,4);
    assert(!m.seats[1].ward);
  });
  await t.test('launcher for blade, pike, armor and both mounts', () => {
    const {engine:m} = board(['liu','lu','cao'],5);
    const equipment = Object.fromEntries(['blade','pike','armor','charge','shelter'].map(k => [k,deal(m,0,k)]));
    const strike = deal(m,0,'thrust');
    assert.equal(m.distance(0,2),2);
    for (const key of Object.keys(equipment)) act(m,'play',{card:equipment[key]});
    assert(m.discard.includes(equipment.blade));
    assert.equal(m.range(m.seats[0]),3);
    assert.equal(m.distance(0,2),1);
    assert.equal(m.distance(2,0),3);
    m.seats[1].ward = true;
    act(m,'play',{card:strike,target:1});
    act(m,'pass');
    assert.equal(m.seats[1].hp,3);
    assert(m.seats[1].ward);
    m.seats[0].power = 1;
    m.open('guard',0,{source:1,mode:'thrust'});
    act(m,'armor');
    assert.equal(m.seats[0].hp,5);
    assert.equal(m.seats[0].power,0);
    assert(m.used(m.seats[0],'armor'));
  });
  await t.test('blade rewards a deflected strike', () => {
    const {engine:m} = board(['liu','cao']);
    const blade = deal(m,0,'blade'), strike = deal(m,0,'thrust'), guard = deal(m,1,'guard');
    act(m,'play',{card:blade});
    act(m,'play',{card:strike,target:1});
    act(m,'respond',{card:guard});
    assert.equal(m.seats[0].power,1);
  });
  await t.test('delayed edict and levy resolve in order and prevent duplicate order', () => {
    const {engine:m} = board(['liu','lu','cao','zhao']);
    const edict = deal(m,0,'edict'), levy = deal(m,0,'levy'), duplicate = deal(m,0,'edict');
    const first = extract(m,'guard',card => card.red), second = extract(m,'guard',card => !card.red);
    m.pile.push(second,first);
    act(m,'play',{card:edict,target:1});
    act(m,'play',{card:levy,target:1});
    assert(!m.options(0).some(a => a.kind === 'play' && a.card === duplicate && a.target === 1));
    restartTurn(m,1);
    assert.equal(m.window.type,'play');
    assert.equal(m.seats[1].hand.length,1);
    assert.equal(m.noAttack,true);
    assert.equal(m.noCommand,true);
    assert.deepEqual(plain(m.discard.slice(-4)),[edict,first,levy,second]);
  });
  await t.test('duel alternates and resolves at the first refusal', () => {
    const {engine:m} = board(['liu','cao']);
    const duel = deal(m,0,'duel'), attack = deal(m,1,'thrust'), feint = deal(m,0,'feint');
    act(m,'play',{card:duel,target:1});
    act(m,'respond',{card:attack});
    assert.equal(m.window.seat,0);
    act(m,'respond',{card:feint});
    assert.equal(m.window.seat,1);
    act(m,'pass');
    assert.equal(m.seats[1].hp,3);
    assert.equal(m.window.type,'play');
  });
  await t.test('flame nests dying rescue, then resumes the next target', () => {
    const {engine:m} = board(['liu','cao','zhao','hua']);
    const flame = deal(m,0,'flame');
    const remedy = deal(m,2,'remedy');
    const guard = deal(m,2,'guard');
    m.seats[1].hp = 1;
    act(m,'play',{card:flame});
    assert.equal(m.window.seat,1);
    act(m,'pass');
    assert.equal(m.window.type,'rescue');
    assert.equal(m.seats[1].hp,0);
    act(m,'pass');
    assert.equal(m.window.seat,2);
    act(m,'respond',{card:remedy});
    assert.equal(m.seats[1].hp,1);
    assert.equal(m.window.type,'guard');
    assert.equal(m.window.seat,2);
    act(m,'respond',{card:guard});
    assert.equal(m.window.seat,3);
    act(m,'pass');
    assert.equal(m.window.type,'play');
  });
});

const skills = {
  cao() {
    const {engine:m} = board(['liu','cao']);
    m.damage(1,0,false);
    m.damage(1,0,false);
    assert.equal(m.seats[1].hand.length,1);
  },
  sima() {
    const {engine:m} = board(['sima','lu']);
    const order = extract(m,'edict'), red = deal(m,0,'guard',c => c.red);
    m.seats[1].delay.push(order);
    restartTurn(m,1);
    assert.equal(m.window.type,'rewrite');
    act(m,'respond',{card:red});
    assert.equal(m.noAttack,true);
    assert(m.discard.includes(red));
  },
  liao() {
    const {engine:m} = board(['liao','lu']);
    const loot = deal(m,1,'guard');
    restartTurn(m,0);
    assert.equal(m.window.type,'harry');
    act(m,'choose',{target:1});
    assert(m.seats[0].hand.includes(loot));
    assert.equal(m.seats[0].hand.length,2);
    assert.equal(m.seats[1].hand.length,0);
  },
  liu() {
    const {engine:m} = board(['liu','lu']);
    const gift = deal(m,0,'armor');
    act(m,'skill',{card:gift,skill:'liu',target:1});
    assert.equal(m.seats[1].hand[0],gift);
    assert.equal(m.seats[1].power,1);
    assert.equal(m.publicFor(null).feed.join(' ').includes('藤甲'),false);
  },
  zhuge() {
    const {engine:m} = board(['zhuge','lu']);
    restartTurn(m,0);
    const [first,second] = m.window.look;
    assert.deepEqual(plain(m.privateFor(m.seats[0].id).look),[first,second]);
    assert.deepEqual(plain(m.privateFor(m.seats[1].id).look),[]);
    assert(!('look' in m.publicFor(null).pending));
    act(m,'choose',{card:second});
    assert.equal(m.seats[0].hand[0],second);
    assert.equal(m.pile[0],first);
  },
  zhao() {
    const {engine:m} = board(['zhao','zhao']);
    const guard = deal(m,0,'guard'), attack = deal(m,1,'thrust');
    act(m,'play',{card:guard,target:1});
    act(m,'respond',{card:attack,skill:'zhao'});
    assert.equal(m.seats[1].hp,4);
    assert(m.used(m.seats[0],'convert'));
    assert(m.used(m.seats[1],'convert'));
  },
  sun() {
    const {engine:m} = board(['sun','lu']);
    const payment = deal(m,0,'guard'), recycled = extract(m,'remedy');
    m.discard.push(recycled);
    act(m,'skill',{card:payment,skill:'sun'});
    assert.deepEqual(plain(m.seats[0].hand),[recycled]);
    assert.equal(m.discard.at(-1),payment);
  },
  zhou() {
    const {engine:m} = board(['zhou','lu']);
    const payment = deal(m,0,'remedy');
    deal(m,1,'guard'); deal(m,1,'pike');
    m.seats[0].power = 1;
    act(m,'skill',{card:payment,skill:'zhou',target:1});
    assert.equal(m.window.mode,'gale');
    act(m,'pass');
    assert.equal(m.seats[1].hp,3);
    assert.equal(m.seats[0].power,0);
  },
  lu() {
    const {engine:m} = board(['lu','liu']);
    for (let i=0;i<7;i++) deal(m,0,'guard');
    act(m,'end-turn');
    assert.equal(m.seats[0].hand.length,7);
    assert(m.events.some(event => event.includes('藏锋留牌')));
    assert.equal(m.seats[0].power,1);
    assert.equal(m.active,1);
  },
  hua() {
    const {engine:m} = board(['hua','lu']);
    const payment = deal(m,0,'guard');
    m.seats[1].hp = 3;
    m.seats[0].power = 2;
    act(m,'skill',{card:payment,skill:'hua',target:1});
    assert.equal(m.seats[1].hp,4);
    assert.equal(m.seats[0].power,1);
    // A different global turn gives the same hero a new rescue opportunity.
    m.turn++;
    m.seats[1].hp = 1;
    const rescue = deal(m,0,'guard');
    m.damage(1,0,false);
    while (m.window.seat !== 0) act(m,'pass');
    act(m,'respond',{card:rescue,skill:'hua'});
    assert.equal(m.seats[1].hp,1);
    assert.equal(m.seats[0].power,0);
  },
  diao() {
    const {engine:m} = board(['diao','lu']);
    const cost = deal(m,0,'guard'), transferred = deal(m,1,'levy');
    act(m,'skill',{card:cost,skill:'diao',target:1});
    assert.equal(m.window.type,'scheme');
    act(m,'pass');
    assert.equal(m.seats[2].hand[0],transferred);
    assert(!m.publicFor(null).feed.join(' ').includes('迟援帖'));
  },
  yuan() {
    const {engine:m} = board(['yuan','lu']);
    const cost = deal(m,0,'guard');
    m.seats[0].power = 2;
    m.seats[1].power = 1;
    act(m,'skill',{card:cost,skill:'yuan'});
    assert.equal(m.window.mode,'banner');
    act(m,'yield');
    assert.equal(m.seats[1].hp,4);
    assert.equal(m.window.seat,2);
    assert.equal(m.seats[0].power,0);
  }
};

test('all 12 distinct hero mechanics execute', async t => {
  assert.deepEqual(Object.keys(skills).sort(),Array.from(game.heroes,h => h.id).sort());
  for (const hero of game.heroes) await t.test(hero.name,skills[hero.id]);
});

test('invalid, duplicate, timed-out and cross-seat actions cannot alter the board', () => {
  const f = board(['liu','lu']);
  const m = f.engine, strike = deal(m,0,'thrust');
  const old = {seq:m.window.seq,kind:'play',card:strike,target:1};
  const before = JSON.stringify(m);
  assert.throws(() => m.act(m.seats[1].id,old),/变化/);
  assert.throws(() => m.act(m.seats[0].id,{...old,target:2}),/不可用/);
  assert.throws(() => m.act(m.seats[0].id,{...old,card:9999}),/不可用/);
  assert.throws(() => m.act(m.seats[0].id,{...old,debug:true}),/字段/);
  assert.equal(JSON.stringify(m),before);
  assert.equal(m.tick(m.window.deadline-1),false);
  m.act(m.seats[0].id,old);
  assert.throws(() => m.act(m.seats[0].id,old),/变化/);
  assert.equal(m.window.type,'guard');
  assert(f.expire());
  assert.equal(m.seats[1].hp,3);
  for (let i=0;i<8;i++) deal(m,0,'guard');
  assert(f.expire());
  assert.equal(m.window.type,'discard');
  assert(f.expire());
  assert.equal(m.seats[0].hand.length,5);
  assert.equal(m.active,1);
});

test('death reveals identity, strips zones, and correct faction result stops pending jobs', () => {
  const f = board(['liu','lu','zhao','cao']);
  const m = f.engine;
  const strike = deal(m,0,'thrust'), privateCard = deal(m,1,'guard');
  m.seats[1].hp=1;
  act(m,'play',{card:strike,target:1});
  act(m,'pass');
  for (let i=0;i<4;i++) assert(f.expire());
  assert.equal(m.seats[1].alive,false);
  assert.equal(m.publicFor(null).seats[1].role,'ally');
  assert(!m.seats[1].hand.includes(privateCard));
  m.seats[0].hp=1;
  m.damage(0,2,false);
  for (let i=0;i<3;i++) assert(f.expire());
  assert.equal(m.result.side,'rebel');
  assert.equal(f.finished.length,1);
  assert.equal(m.window,null);
});

function scripts(html) {
  return Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),m => m[1]);
}

function lobbyWorld() {
  const candidate = scripts(raw(release));
  const registry = new Map();
  const world = vm.createContext({crypto:webcrypto,setInterval:() => 0,document:{readyState:'loading'},
    BlackmiApps:{register(def) { registry.set(def.id,def); },close() {}},console});
  const script = candidate.find(code => code.includes('class Lobby {'));
  vm.runInContext(script.replace('})(globalThis);','globalThis.TestLobby = Lobby;\n})(globalThis);'),world);
  for (const code of candidate.slice(-5)) vm.runInContext(code,world);
  return world;
}

function linked(host,Lobby,name) {
  const guest = new Lobby(), channel = [], received = [];
  host.pending = {token:'pair',send(message) {
    const parsed = plain(message);
    received.push(parsed);
    channel.push(() => guest.receive(remote,parsed));
    return true;
  }};
  const local = host.pending;
  const remote = {token:'pair',send(message) { channel.push(() => host.receive(local,plain(message))); return true; }};
  host.links.push(local);
  guest.role='guest';
  guest.lobby=host.lobby;
  guest.name=name;
  guest.links.push(remote);
  guest.pending=remote;
  guest.open(remote);
  const drain = () => { while (channel.length) channel.shift()(); };
  drain();
  return {guest,local,remote,received,drain};
}

test('all 14 pre-existing games start in the V3.3 bundle', () => {
  const world = lobbyWorld();
  const existing = world.BlackmiSDK.games.list().filter(game => game.id !== 'three-kingdoms');
  assert.equal(existing.length,14);
  for (const game of existing) {
    const host = new world.TestLobby();
    host.create('Host');
    for (let seat = 1; seat < game.minPlayers; seat++) {
      host.players.push({id:'sim-'+seat,name:'Seat '+seat,ready:false});
    }
    host.prepare(game.id);
    host.players.forEach((player,seat) => {
      host.assign(player.id,seat,host.me);
      host.setReady(player.id,true,seat);
    });
    host.start(game.id);
    assert.equal(host.state.kind,game.id);
    assert.equal(host.state.players.length,game.minPlayers);
  }
});

test('bundled game through SDK Lobby uses private projections, ACK, dedupe, recovery and disconnect', () => {
  const world = lobbyWorld(), Lobby = world.TestLobby;
  assert.equal(world.BlackmiSDK.games.list().length,15);
  const host = new Lobby();
  host.create('Host');
  const peers = ['A','B','C','D'].map(name => linked(host,Lobby,name));
  const drain = () => peers.forEach(p => p.drain());
  drain();
  const players = [host.me,...peers.slice(0,3).map(p => p.guest.me)];
  const gameId='three-kingdoms';
  function start() {
    host.prepare(gameId);
    players.forEach((id,seat) => { host.assign(id,seat,host.me); host.setReady(id,true,seat); });
    host.start(gameId); drain();
  }
  start();
  const m = host.match.rules;
  for (const p of peers) {
    const id = p.guest.me, packet = p.received.findLast(x => x.t === 'snapshot');
    assert.equal(packet.state.kind,gameId);
    assert.deepEqual(packet.private,plain(m.privateFor(id)));
    assert(!packet.state.data.seats.some(seat => 'hand' in seat));
    assert.equal(packet.state.data.seats.filter(seat => seat.role !== null).length,1);
  }
  assert.deepEqual(plain(peers[3].guest.private),{});
  // Move to a real guest's legal input window and submit twice with the same request id.
  m.window = null;
  m.jobs = [];
  m.phase = 'play';
  m.active = 1;
  m.open('play',1);
  host.sync(); drain();
  const peer = peers[0];
  const seq = m.window.seq, originalRev = host.state.rev;
  const message = {v:1,lobby:host.lobby,t:'action',match:host.state.id,req:'stable-test',action:{kind:'end-turn',seq}};
  peer.remote.send(message); peer.remote.send(message); drain();
  assert.equal(host.state.rev,originalRev+1);
  assert.equal(peer.received.filter(x => x.t==='ack' && x.req==='stable-test').length,1);
  peer.remote.send({...message,req:'stale-test'}); drain();
  assert.equal(host.state.rev,originalRev+1);
  assert(!peer.received.some(x => x.t==='ack' && x.req==='stale-test'));
  host.match.rules.publicFor = () => { throw Error('synthetic projection fault'); };
  assert.equal(host.sync(),false); drain();
  assert.equal(host.state,null);
  assert(peers.every(p => p.guest.state===null && Object.keys(p.guest.private).length===0));
  start();
  host.drop(peer.local,'Closed');
  drain();
  assert.equal(peers[3].guest.state.phase,'aborted');
  assert.deepEqual(plain(peers[3].guest.private),{});
});

test('release is reproducible, modules fit budget, source prefix including communication is byte-identical', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'tk-rebuild-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const regenerated = build(path.join(dir,'copy.html'));
  assert.deepEqual(fs.readFileSync(regenerated),fs.readFileSync(release));
  const output = raw(release);
  const before = raw(basePath).split('<!-- BLACKMI_SDK_BUNDLES -->');
  const markup = output.slice(0,output.indexOf('<script>\n'+source[0]))
    .replace('name="blackmi-version" content="3.3"','name="blackmi-version" content="3.2.2"')
    .replace("APP_EDITION='Three Kingdoms'","APP_EDITION='Developer SDK'");
  assert.equal(markup,before[0]);
  assert(output.endsWith(before[1]));
  assert(scripts(output).slice(-5).every((code,i) => code==='\n'+source[i]+'\n'));
  assert(source.reduce((size,code)=>size+Buffer.byteLength(code),0)<=100*1024);
});

test('125 seeded full games verify windows, phase monotonicity, card conservation and snapshot budgets', t => {
  const samples = [], envelopeSamples = [], outcomes = {};
  const comments = count => Array.from({length:30}, (_,i) => ({id:'c'.repeat(24), name:'名'.repeat(24),
    text:'议'.repeat(count), time:1700000000000+i, spectator:false}));
  const typicalComments = comments(24), longestComments = comments(120);
  let decisions = 0, typicalMax = 0, longestMax = 0;
  for (let run = 0; run < 125; run++) {
    const f = match(4 + run % 5,3001 + run);
    const m = f.engine;
    for (let step = 0; !m.result && step < 4500; step++) {
      const w = m.window;
      const options = m.options(w.seat);
      assert(options.length, 'empty response list');
      const timeout = f.random() < 0.12;
      const payload = {...options[Math.floor(f.random()*options.length)],seq:w.seq};
      const start = performance.now();
      if (timeout) assert(f.expire());
      else m.act(m.seats[w.seat].id,payload);
      samples.push(performance.now()-start);
      verifyInvariants(m,f.now());
      assert(!m.window || m.window.seq>w.seq);
      decisions++;
      if (m.window && (step % 12 === 0 || m.window.type === 'stars')) {
        const snapshot = {v:1,t:'snapshot',lobby:'a'.repeat(24),hostTime:f.now(),
          state:{id:'b'.repeat(24),kind:'three-kingdoms',phase:'play',rev:step,players:f.ids.map((_,i)=>String(i).repeat(24)),
            comments:[],winner:null,data:m.publicFor(null)},private:m.privateFor(m.seats[m.window.seat].id)};
        for (let i=0;i<snapshot.state.data.seats.length;i++) snapshot.state.data.seats[i].id=snapshot.state.players[i];
        const serialized = JSON.stringify(snapshot);
        assert(serialized.length<=120000);
        const size=Buffer.byteLength(serialized);
        assert(size<=16*1024);
        envelopeSamples.push(size);
        snapshot.state.comments = typicalComments;
        const typicalSize = Buffer.byteLength(JSON.stringify(snapshot));
        assert(typicalSize<=16*1024);
        typicalMax = Math.max(typicalMax,typicalSize);
        snapshot.state.comments = longestComments;
        const saturated = JSON.stringify(snapshot);
        assert(saturated.length<=120000);
        longestMax = Math.max(longestMax,Buffer.byteLength(saturated));
      }
    }
    assert(m.result, 'match exceeded step bound for seed ' + (3001+run));
    assert.equal(f.finished.length,1);
    assert.equal(m.window,null);
    outcomes[m.result.side]=(outcomes[m.result.side]||0)+1;
  }
  samples.sort((a,b)=>a-b);
  envelopeSamples.sort((a,b)=>a-b);
  t.diagnostic(JSON.stringify({games:125,decisions,outcomes,snapshotSamples:envelopeSamples.length,
    maxSnapshotBytes:envelopeSamples.at(-1),p95SnapshotBytes:envelopeSamples[Math.floor(envelopeSamples.length*.95)],
    maxTypicalCommentBytes:typicalMax,maxSaturatedCommentBytes:longestMax,
    p95RuleMs:+samples[Math.floor(samples.length*.95)].toFixed(3),maxRuleMs:+samples.at(-1).toFixed(3)}));
});
