const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { bundle } = require('../sdk/bundle.cjs');

const repo = path.join(__dirname, '..');
const historical = load('client/Blackmi_OS_V3.2.1_Kingdoms.html');
const candidate = load('client/Blackmi_OS_V3.2.2_DeveloperSDK.html');
const counter = 'sdk/examples/counter.js';
const stones = 'sdk/examples/take-stones.js';

function load(file) {
  return fs.readFileSync(path.join(repo, file), 'utf8');
}

function scripts(html) {
  return Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), match => match[1]);
}

function section(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert(start >= 0 && end >= start, from);
  return source.slice(start, end);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness() {
  const frames = new Map();
  let frame = 0;
  const document = new EventTarget();
  document.readyState = 'loading';
  document.hidden = false;
  const events = new Map();
  const context = vm.createContext({
    document,
    crypto: webcrypto,
    console,
    setInterval: () => 0,
    requestAnimationFrame: callback => {
      frames.set(++frame, callback);
      return frame;
    },
    cancelAnimationFrame: id => frames.delete(id),
    D: document,
    APPS: Object.create(null),
    wins: {},
    state: { active: '', dark: false },
    iconPaths: { apps: '' },
    body: () => new EventTarget(),
    coreStatus: { label: '离线' },
    scheduleDesktop() {},
    openApp() {},
    closeApp() {},
    bus: {
      on(name, fn) {
        const listeners = events.get(name) || new Set();
        events.set(name, listeners);
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      emit(name, data) {
        for (const fn of [...(events.get(name) || [])]) fn(data);
      }
    }
  });
  vm.runInContext('var window = globalThis;', context);
  const [embedded, shell, , game] = scripts(candidate);
  assert(embedded && shell && game.includes('class Lobby {'));
  vm.runInContext(section(shell, '/* Blackmi App Framework', '/* Local compatibility monitor'), context);
  vm.runInContext(game.replace('})(globalThis);', 'globalThis.TestLobby = Lobby;\n})(globalThis);'), context);
  return { context, frames, global: context, sdk: context.BlackmiSDK, Lobby: context.TestLobby };
}

function channel(host) {
  const pending = [];
  const sent = [];

  function drain() {
    while (pending.length) pending.shift()();
  }

  function join(Lobby, name) {
    const guest = new Lobby();
    const guestLink = {
      token: 'token',
      flush() {},
      send(message) {
        const copy = plain(message);
        sent.push({ name, direction: 'host', message: copy });
        pending.push(() => host.receive(hostLink, copy));
        return true;
      }
    };
    const hostLink = {
      token: 'token',
      flush() {},
      send(message) {
        const copy = plain(message);
        sent.push({ name, direction: 'guest', message: copy });
        pending.push(() => guest.receive(guestLink, copy));
        return true;
      }
    };
    guest.role = 'guest';
    guest.lobby = host.lobby;
    guest.name = name;
    guest.pending = guestLink;
    guest.links.push(guestLink);
    host.pending = hostLink;
    host.links.push(hostLink);
    guest.open(guestLink);
    drain();
    assert(guest.me);
    return { guest, hostLink, guestLink };
  }

  return { join, drain, sent };
}

test('frozen communication, attribution and notice placement match V3.2.1', () => {
  const [oldCore, oldShell, oldQr, oldGame] = scripts(historical);
  const [core, shell, qr, game] = scripts(candidate);
  assert.equal(core, oldCore);
  assert.equal(qr, oldQr);
  assert.equal(section(shell, 'function corePost(', 'function toast('),
    section(oldShell, 'function corePost(', 'function toast('));
  assert.equal(section(game, 'class Link {', '// V2.8 application-layer games'),
    section(oldGame, 'class Link {', '// V2.8 application-layer games'));
  const pairing = source => section(source.slice(source.indexOf('class Lobby {')), ' async offer(', ' sync(l)');
  assert.equal(pairing(game), pairing(oldGame));
  assert.equal(candidate.match(/<meta name="AIGC"[^>]+>/)[0], historical.match(/<meta name="AIGC"[^>]+>/)[0]);
  assert.equal(candidate.slice(candidate.indexOf('/* 3.1.2 Notice-safe'), candidate.lastIndexOf('</style>')),
    historical.slice(historical.indexOf('/* 3.1.2 Notice-safe'), historical.lastIndexOf('</style>')));
  assert.doesNotMatch(candidate, /<script\b[^>]*\bsrc\s*=|<link\b[^>]*rel\s*=\s*['"]?stylesheet/i);
  for (const script of [...scripts(candidate).slice(1), ...scripts(JSON.parse(core))]) {
    assert.doesNotThrow(() => new vm.Script(script));
  }
});

test('registration keeps 14 built-ins playable and advertises exact football sizes', () => {
  const { sdk, Lobby } = harness();
  assert.equal(sdk.games.list().length, 14);
  assert.deepEqual(plain(sdk.games.list().find(game => game.id === 'football').playerCounts), [2, 4, 6, 8]);
  for (const game of sdk.games.list()) {
    const lobby = new Lobby();
    lobby.create('Host');
    const players = [lobby.me];
    for (let i = 1; i < game.minPlayers; i++) {
      players.push('p' + i);
      lobby.players.push({ id: 'p' + i, name: 'P' + i, ready: false });
    }
    lobby.prepare(game.id);
    players.forEach((id, slot) => {
      lobby.assign(id, slot, lobby.me);
      lobby.setReady(id, true, slot);
    });
    lobby.start(game.id);
    assert.equal(lobby.state.kind, game.id);
    assert.equal(lobby.state.players.length, players.length);
  }
});

test('app invalidations coalesce, pause in background, and cancel on close', () => {
  const { sdk, global, frames } = harness();
  let app;
  let draws = 0;
  sdk.apps.register({
    id: 'render-test',
    mount(ctx) {
      app = ctx.onRender(() => draws++);
      app.invalidate();
    }
  });
  const id = 'render-test';
  global.wins[id] = { classList: { contains: () => false } };
  global.mountRegistered(id);
  assert.equal(frames.size, 0);
  global.state.active = id;
  global.reconcileApps();
  app.invalidate();
  app.invalidate();
  assert.equal(frames.size, 1);

  function flushFrame() {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback(16);
  }

  flushFrame();
  assert.equal(draws, 1);
  assert.equal(frames.size, 0);
  app.invalidate();
  global.document.hidden = true;
  global.reconcileApps();
  assert.equal(frames.size, 0);
  app.invalidate();
  global.document.hidden = false;
  global.reconcileApps();
  flushFrame();
  assert.equal(draws, 2);
  app.invalidate();
  global.disposeRegistered(id);
  app.invalidate();
  assert.equal(frames.size, 0);
});

test('SDK game uses the host/guest Lobby, isolates private views and handles stale actions', () => {
  const { sdk, context, Lobby } = harness();
  const game = {
    id: 'private-demo',
    name: 'Private Demo',
    minPlayers: 2,
    maxPlayers: 2,
    createMatch(match) {
      let moves = 0;
      const secrets = Object.fromEntries(match.players.map((id, index) => [id, 'secret-' + index]));
      return {
        publicFor: id => ({ moves, ownSeat: match.players.indexOf(id) }),
        privateFor: id => ({ secret: secrets[id] }),
        act(id, action) {
          if (id !== match.players[moves] || action.kind !== 'commit' || action.move !== moves) {
            throw Error('Invalid turn');
          }
          moves++;
          if (moves === 2) match.finish(id);
        }
      };
    },
    mount() { return { render() {} }; }
  };
  assert.throws(() => sdk.games.register({ ...game, id: 'bad-count', maxPlayers: 9 }), /人数/);
  assert.throws(() => sdk.games.register({ ...game, id: 'uno' }), /重复/);
  assert.throws(() => sdk.games.register({ ...game, id: 'game-center' }), /duplicate/);
  assert(!sdk.games.list().some(item => item.id === 'bad-count'));
  assert.equal(sdk.games.register(game), game.id);
  assert.throws(() => sdk.games.register(game), /重复/);
  context.document.readyState = 'complete';
  assert.throws(() => sdk.games.register({ ...game, id: 'late-game' }), /启动时/);

  const host = new Lobby();
  host.create('Host observer');
  const wire = channel(host);
  const a = wire.join(Lobby, 'Alice');
  const b = wire.join(Lobby, 'Bob');
  const observer = wire.join(Lobby, 'Observer');
  host.prepare(game.id);
  wire.drain();
  a.guest.seat(0);
  b.guest.seat(1);
  wire.drain();
  a.guest.ready(true);
  b.guest.ready(true);
  wire.drain();
  host.start(game.id);
  wire.drain();
  assert.equal(a.guest.state.data.ownSeat, 0);
  assert.equal(b.guest.state.data.ownSeat, 1);
  assert.equal(observer.guest.state.data.ownSeat, -1);
  assert.equal(host.state.data.ownSeat, -1);
  assert.deepEqual(plain(host.private), {});
  assert.deepEqual(plain(a.guest.private), { secret: 'secret-0' });
  assert.deepEqual(plain(b.guest.private), { secret: 'secret-1' });
  assert.deepEqual(plain(observer.guest.private), {});
  for (const entry of wire.sent.filter(x => x.direction === 'guest' && x.message.state)) {
    const expected = { Alice: ['secret-0'], Bob: ['secret-1'], Observer: [] }[entry.name];
    assert.deepEqual(JSON.stringify(entry.message).match(/secret-\d/g) || [], expected);
  }

  observer.guest.act({ kind: 'commit', move: 0 });
  wire.drain();
  assert.match(observer.guest.error, /观战者/);
  a.guest.act({ kind: 'stroke' });
  wire.drain();
  assert.match(a.guest.error, /无效/);
  const oldId = host.state.id;
  a.guest.act({ kind: 'commit', move: 0 });
  assert.equal(a.guest.awaiting, true);
  wire.drain();
  assert.equal(a.guest.awaiting, false);
  assert.equal(host.state.data.moves, 1);
  const first = wire.sent.findLast(x => x.direction === 'host' && x.name === 'Alice' && x.message.t === 'action').message;
  host.receive(a.hostLink, first);
  assert.equal(host.state.data.moves, 1);
  b.guest.act({ kind: 'commit', move: 1 });
  wire.drain();
  assert.equal(observer.guest.state.phase, 'end');
  assert.equal(observer.guest.state.winner, b.guest.me);
  assert.deepEqual(plain(observer.guest.private), {});
  assert(wire.sent.some(x => x.message.t === 'ack' && x.message.req === first.req));

  host.end();
  host.prepare(game.id);
  host.assign(a.guest.me, 0, host.me);
  host.assign(b.guest.me, 1, host.me);
  host.setReady(a.guest.me, true, 0);
  host.setReady(b.guest.me, true, 1);
  host.start(game.id);
  wire.drain();
  assert.notEqual(host.state.id, oldId);
  host.receive(a.hostLink, first);
  wire.drain();
  assert.match(a.guest.error, /已变化/);
  assert.equal(host.state.data.moves, 0);
  host.drop(b.hostLink, 'Closed');
  wire.drain();
  assert.equal(observer.guest.state.phase, 'aborted');
});

test('single-file bundler embeds examples and preserves the historical HTML', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackmi-sdk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'demo.html');
  const inputs = [counter, stones].map(file => path.join(repo, file));
  const before = fs.readFileSync(inputs[0], 'utf8');
  bundle(output, inputs);
  const result = fs.readFileSync(output, 'utf8');
  assert(!result.includes('<!-- BLACKMI_SDK_BUNDLES -->'));
  assert(result.includes(before));
  assert.equal(scripts(result).length, scripts(candidate).length + 2);
  assert.equal(fs.readFileSync(inputs[0], 'utf8'), before);
  assert.throws(() => bundle(output, inputs), /EEXIST/);
  const bad = path.join(dir, 'bad.js');
  fs.writeFileSync(bad, 'var x = "</script>";');
  assert.throws(() => bundle(path.join(dir, 'bad.html'), [bad]), /HTML script/);

  const { sdk, context, Lobby } = harness();
  for (const script of scripts(result).slice(-2)) vm.runInContext(script, context);
  assert(sdk.apps.list().some(app => app.id === 'demo-counter'));
  assert(sdk.games.list().some(game => game.id === 'take-stones'));
  const host = new Lobby();
  host.create('Host');
  host.players.push({ id: 'guest', name: 'Guest' });
  host.prepare('take-stones');
  host.assign(host.me, 0, host.me);
  host.assign('guest', 1, host.me);
  host.setReady(host.me, true, 0);
  host.setReady('guest', true, 1);
  host.start('take-stones');
  assert.equal(host.state.data.remaining, 15);
  for (let move = 0; move < 5; move++) {
    host.action(move % 2 ? 'guest' : host.me, { kind: 'take', count: 3, move });
  }
  assert.equal(host.state.data.remaining, 0);
  assert.equal(host.state.winner, host.me);
});
