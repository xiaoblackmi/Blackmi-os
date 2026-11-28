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
  vm.runInContext(game.replace('})(globalThis);',
    'globalThis.TestLobby = Lobby; globalThis.testGameEntry = lobbyGameEntry;\n})(globalThis);'), context);
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
      opened: true,
      last: Date.now(),
      flush() {},
      close(reason) {
        if (this.dead) return;
        this.dead = true;
        guest.drop(this, reason);
      },
      send(message) {
        const copy = plain(message);
        sent.push({ name, direction: 'host', message: copy });
        pending.push(() => host.receive(hostLink, copy));
        return true;
      }
    };
    const hostLink = {
      token: 'token',
      opened: true,
      last: Date.now(),
      flush() {},
      close(reason) {
        if (this.dead) return;
        this.dead = true;
        host.drop(this, reason);
        pending.push(() => guestLink.close(reason));
      },
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

function setupMatch(host, wire, kind, players) {
  host.prepare(kind);
  players.forEach((id, slot) => {
    host.assign(id, slot, host.me);
    host.setReady(id, true, slot);
  });
  wire.drain();
}

function sdkRoom(createMatch) {
  const { sdk, Lobby } = harness();
  const kind = 'sdk-test-fixture';
  sdk.games.register({
    id: kind, name: 'SDK test fixture', minPlayers: 2, maxPlayers: 2, createMatch,
    mount() { return { render() {} }; }
  });
  const host = new Lobby();
  host.create('Host');
  const wire = channel(host);
  const a = wire.join(Lobby, 'Alice');
  const b = wire.join(Lobby, 'Bob');
  const players = [a.guest.me, b.guest.me];
  setupMatch(host, wire, kind, players);
  return { host, wire, kind, a, b, players, Lobby };
}

function expectRecovery(room, message) {
  const { host, wire, a, b } = room;
  wire.drain();
  assert.equal(host.match, null);
  for (const lobby of [host, a.guest, b.guest]) {
    assert.equal(lobby.state, null);
    assert.deepEqual(plain(lobby.private), {});
    assert.equal(lobby.awaiting, false);
    assert.match(lobby.error, message);
  }
  assert.equal(host.players.length, 3);
  assert.equal(wire.sent.filter(x => x.message.t === 'ack').length, 0);
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
  const lobby = source => source.slice(source.indexOf('class Lobby {'));
  for (const [start, end] of [
    [' async offer(', "if(m.t==='ping')"],
    ["else if(this.role==='guest'){if(m.t==='welcome'", "if(m.t==='roster')"]
  ]) {
    assert.equal(section(lobby(game), start, end), section(lobby(oldGame), start, end));
  }
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

test('repeatedly faulty tick is isolated and lobby flush, heartbeat and timeouts continue', () => {
  let ticks = 0;
  const room = sdkRoom(() => ({
    publicFor: () => ({ ready: true }),
    act() {},
    tick() { ++ticks; throw Error('bad tick'); }
  }));
  const { host, wire, kind, a, players, Lobby } = room;
  let flushes = 0;
  a.hostLink.flush = () => { ++flushes; };
  const expired = wire.join(Lobby, 'Expired observer');
  expired.hostLink.last = Date.now() - 46000;
  const pending = {
    started: Date.now() - 181000,
    pc: { iceConnectionState: 'checking', signalingState: 'stable' },
    flush() {},
    close(reason) { host.drop(this, reason); }
  };
  host.pending = pending;
  host.links.push(pending);
  host.start(kind);
  wire.drain();
  host.tick();
  expectRecovery(room, /计时失败/);
  assert.equal(host.pending, null);
  assert.equal(expired.guest.me, null);
  assert(!host.links.includes(pending));
  for (let game = 0; game < 2; game++) {
    setupMatch(host, wire, kind, players);
    host.start(kind);
    wire.drain();
    host.tick();
    expectRecovery(room, /计时失败/);
    host.tick();
  }
  assert.equal(ticks, 3);
  assert.equal(flushes, 5);
  a.guest.tick();
  wire.drain();
  assert(wire.sent.some(x => x.name === 'Alice' && x.message.t === 'pong'));
  a.guest.awaiting = true;
  a.guest.lastSent = Date.now() - 11000;
  a.guest.tick();
  assert.equal(a.guest.awaiting, false);
  assert.match(a.guest.error, /确认超时/);
  setupMatch(host, wire, 'gomoku', players);
  host.start('gomoku');
  wire.drain();
  assert.equal(a.guest.state.kind, 'gomoku');
});

test('checks whole serialized snapshot at 120000 characters and suppresses ACK above it', () => {
  let payload = '';
  const room = sdkRoom(match => ({
    publicFor: () => ({ ready: true }),
    privateFor: id => ({ payload: id === match.players[1] ? payload : '' }),
    act() {}
  }));
  const { host, wire, kind, a, b } = room;
  host.start(kind);
  wire.drain();
  const base = wire.sent.find(x => x.name === 'Bob' && x.message.state).message;
  payload = 'x'.repeat(120000 - JSON.stringify(base).length);
  wire.sent.length = 0;
  a.guest.act({ kind: 'commit' });
  wire.drain();
  const full = wire.sent.find(x => x.name === 'Bob' && x.message.state).message;
  assert.equal(JSON.stringify(full).length, 120000);
  assert(wire.sent.some(x => x.name === 'Alice' && x.message.t === 'ack'));
  assert.equal(a.guest.private.payload, '');
  assert.equal(b.guest.private.payload, payload);
  wire.sent.length = 0;
  // A backslash occupies two serialized characters. The raw projection is still below the cap.
  payload += '\\';
  assert(payload.length < 120000);
  a.guest.act({ kind: 'commit' });
  expectRecovery(room, /120000/);
  assert(!wire.sent.some(x => x.message.t === 'snapshot' && x.message.state));
});

test('late projection failure sends only neutral reset and keeps private views isolated', () => {
  let failure = '';
  const projected = [];
  const room = sdkRoom(match => ({
    publicFor(id) {
      if (failure === 'public' && id === match.players[1]) throw Error('private diagnostic');
      return { seat: match.players.indexOf(id) };
    },
    privateFor(id) {
      projected.push(id);
      if (failure === 'private' && id === match.players[1]) throw Error('private diagnostic');
      return { secret: [{ value: 'secret-' + match.players.indexOf(id) }] };
    },
    act() {}
  }));
  const { host, wire, kind, a, b, players, Lobby } = room;
  const observer = wire.join(Lobby, 'Observer');
  for (const phase of ['private', 'public']) {
    failure = '';
    if (!host.setup) setupMatch(host, wire, kind, players);
    host.start(kind);
    wire.drain();
    assert.deepEqual(plain(a.guest.private), { secret: [{ value: 'secret-0' }] });
    assert.deepEqual(plain(b.guest.private), { secret: [{ value: 'secret-1' }] });
    assert.deepEqual(plain(observer.guest.private), {});
    projected.length = 0;
    wire.sent.length = 0;
    failure = phase;
    a.guest.act({ kind: 'commit' });
    wire.drain();
    for (const lobby of [host, a.guest, b.guest, observer.guest]) {
      assert.equal(lobby.state, null);
      assert.deepEqual(plain(lobby.private), {});
      assert.match(lobby.error, /快照投影或序列化失败/);
    }
    assert(projected.includes(a.guest.me));
    const snapshots = wire.sent.filter(x => x.message.t === 'snapshot');
    assert.equal(snapshots.length, 3);
    assert(snapshots.every(x => x.message.state === null && !Object.keys(x.message.private).length));
    assert(!wire.sent.some(x => x.message.t === 'ack'));
    assert.doesNotMatch(JSON.stringify(wire.sent), /private diagnostic|secret-/);
  }
  assert.equal(host.players.length, 4);
});

test('a targeted sync request with a projection fault resets the entire match', () => {
  let broken = false;
  const room = sdkRoom(match => ({
    publicFor: () => ({}),
    privateFor(id) {
      if (broken && id === match.players[1]) throw Error('projection');
      return {};
    },
    act() {}
  }));
  const { host, wire, kind, b } = room;
  host.start(kind);
  wire.drain();
  wire.sent.length = 0;
  broken = true;
  b.guestLink.send({ v: 1, t: 'sync.request', lobby: host.lobby });
  expectRecovery(room, /投影/);
  assert.equal(wire.sent.filter(x => x.message.t === 'snapshot').length, 2);
});

test('actual send refusal or synchronous close triggers recovery without ACK', async t => {
  for (const mode of ['returns false', 'returns true after close', 'cannot accept reset']) {
    await t.test(mode, () => {
      const room = sdkRoom(() => ({
        publicFor: () => ({ ready: true }),
        act() {}
      }));
      const { host, wire, kind, a, b } = room;
      host.start(kind);
      wire.drain();
      const send = b.hostLink.send.bind(b.hostLink);
      b.hostLink.send = function(packet) {
        if (packet.t !== 'snapshot') return send(packet);
        if (mode === 'cannot accept reset') return false;
        if (!packet.state) return send(packet);
        if (mode === 'returns false') return false;
        this.close('发送失败');
        return true;
      };
      wire.sent.length = 0;
      a.guest.act({ kind: 'commit' });
      wire.drain();
      assert.equal(host.match, null);
      assert.equal(a.guest.state, null);
      assert.match(a.guest.error, /快照发送失败/);
      assert.equal(a.guest.awaiting, false);
      assert(!wire.sent.some(x => x.message.t === 'ack'));
      const revisions = wire.sent.filter(x => x.name === 'Alice' && x.message.t === 'snapshot');
      assert.deepEqual(revisions.map(x => x.message.state && x.message.state.rev), [1, null]);
      if (mode === 'returns false') {
        assert.equal(b.guest.state, null);
        assert.equal(host.players.length, 3);
        b.hostLink.send = send;
      } else {
        assert.equal(b.guest.state.phase, 'aborted');
        assert.equal(b.guest.me, null);
        assert.equal(a.guest.players.length, 2);
      }
      setupMatch(host, wire, 'gomoku', [host.me, a.guest.me]);
      host.start('gomoku');
      wire.drain();
      assert.equal(a.guest.state.kind, 'gomoku');
    });
  }
});

test('rejects thenables from all synchronous SDK rule callbacks', async t => {
  for (const method of ['createMatch', 'publicFor', 'privateFor', 'tick', 'act']) {
    await t.test(method, () => {
      const rejected = () => Promise.reject(Error('async detail'));
      let active = false;
      const room = sdkRoom(() => {
        if (method === 'createMatch') return rejected();
        const values = { publicFor: () => ({}), privateFor: () => ({}), tick: () => false, act() {} };
        const original = values[method];
        values[method] = () => active ? rejected() : original();
        return values;
      });
      const { host, wire, kind, a } = room;
      if (method === 'createMatch') {
        assert.throws(() => host.start(kind), /createMatch 必须同步/);
        assert.equal(host.match, null);
        assert.equal(host.setup.kind, kind);
        return;
      }
      host.start(kind);
      wire.drain();
      active = true;
      if (method === 'tick') host.tick();
      else a.guest.act({ kind: 'commit' });
      expectRecovery(room, ['tick', 'act'].includes(method) ? /必须同步/ : /投影/);
    });
  }
});

test('SDK UI views are deeply read-only and disconnect installs an aborted view', () => {
  const model = { cards: [{ value: 2 }] };
  const room = sdkRoom(() => ({
    publicFor: () => ({ rows: [{ value: 1 }] }),
    privateFor: () => model,
    act() {}
  }));
  const { host, wire, kind, a } = room;
  host.start(kind);
  wire.drain();
  for (const lobby of [host, a.guest]) {
    assert(Object.isFrozen(lobby.state));
    assert(Object.isFrozen(lobby.state.players));
    assert(Object.isFrozen(lobby.state.comments));
    assert(Object.isFrozen(lobby.state.data.rows[0]));
    assert.equal(Reflect.set(lobby.state.data.rows[0], 'value', 9), false);
  }
  assert(Object.isFrozen(a.guest.private.cards[0]));
  assert(!Object.isFrozen(model.cards[0]));
  const previous = a.guest.state;
  a.guestLink.close('offline');
  assert.equal(previous.phase, 'play');
  assert.equal(a.guest.state.phase, 'aborted');
  assert.deepEqual(plain(a.guest.private), {});
});

test('missing embedded game shows guidance in place of an unusable entry', () => {
  const { context } = harness();
  assert.match(context.testGameEntry('not-installed', '进入对局'), /缺少此游戏模块/);
  assert.doesNotMatch(context.testGameEntry('not-installed', '进入对局'), /<button/);
  assert.match(context.testGameEntry('gomoku', '进入对局'), /data-g="open:gomoku"/);
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
