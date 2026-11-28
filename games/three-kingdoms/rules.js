(function(game) {
  'use strict';
  var deck = game.deck;
  var heroTable = Object.create(null);
  game.heroes.forEach(function(hero) { heroTable[hero.id] = hero; });
  var timed = {play:38000, discard:12000, guard:10000, duel:10000, rescue:8000,
    stars:10000, rewrite:10000, harry:10000, scheme:10000};
  var slots = ['weapon', 'armor', 'charge', 'shelter'];
  var gear = {blade:'weapon', pike:'weapon', armor:'armor', charge:'charge', shelter:'shelter'};
  var actionFields = ['kind', 'card', 'target', 'skill', 'choice'];
  var MAX_HAND = deck.length;

  function requireRule(value, message) {
    if (!value) throw Error(message);
  }

  function shuffle(values, random) {
    var out = values.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var temp = out[i];
      out[i] = out[j];
      out[j] = temp;
    }
    return out;
  }

  function roles(count) {
    requireRule(Number.isInteger(count) && count >= 4 && count <= 8, '需要 4–8 个座位');
    var allies = count >= 7 ? 2 : 1;
    return ['lord', 'rogue'].concat(Array(allies).fill('ally'), Array(count - allies - 2).fill('rebel'));
  }

  function winner(seats) {
    var living = seats.filter(function(seat) { return seat.alive; });
    var lord = living.some(function(seat) { return seat.role === 'lord'; });
    if (!lord) return living.length === 1 && living[0].role === 'rogue' ? 'rogue' : 'rebel';
    return living.some(function(seat) { return seat.role === 'rebel' || seat.role === 'rogue'; }) ? null : 'court';
  }

  function randomSource() {
    var words = new Uint32Array(64), index = words.length;
    return function() {
      if (index === words.length) {
        crypto.getRandomValues(words);
        index = 0;
      }
      return words[index++] / 4294967296;
    };
  }

  function cardKey(id) { return deck[id].key; }
  function attack(key) { return key === 'thrust' || key === 'feint'; }

  class Match {
    constructor(info, controls) {
      this.finish = info.finish;
      this.clock = controls.clock || Date.now;
      this.random = controls.random || randomSource();
      var assigned = shuffle(roles(info.players.length), this.random);
      var heroes = shuffle(game.heroes, this.random);
      this.seats = info.players.map(function(id, i) {
        var hero = heroes[i], hp = hero.hp + (assigned[i] === 'lord' ? 1 : 0);
        return {id:id, hero:hero.id, role:assigned[i], hp:hp, max:hp, alive:true, hand:[],
          gear:{weapon:null, armor:null, charge:null, shelter:null}, delay:[], ward:false,
          power:0, used:Object.create(null)};
      });
      this.pile = shuffle(deck.map(function(card) { return card.id; }), this.random);
      this.discard = [];
      this.events = [];
      this.jobs = [];
      this.window = null;
      this.serial = 0;
      this.turn = 0;
      this.result = null;
      this.turnCap = this.seats.length * 12;
      for (var seat of this.seats) this.draw(seat, 4);
      this.begin(this.seats.findIndex(function(seat) { return seat.role === 'lord'; }));
      this.pump();
    }

    record(message) {
      this.events.push(message);
      if (this.events.length > 8) this.events.shift();
    }

    label(index) { return heroTable[this.seats[index].hero].name; }
    index(id) { return this.seats.findIndex(function(seat) { return seat.id === id; }); }

    order(start, include) {
      var result = [], count = this.seats.length;
      for (var step = include ? 0 : 1; step < count; step++) {
        var index = (start + step) % count;
        if (this.seats[index].alive) result.push(index);
      }
      return result;
    }

    distance(source, target) {
      if (source === target) return 0;
      var circle = this.order(source, true);
      var steps = circle.indexOf(target);
      return Math.max(1, Math.min(steps, circle.length - steps) -
        Number(this.seats[source].gear.charge !== null) + Number(this.seats[target].gear.shelter !== null));
    }

    range(player) {
      var weapon = player.gear.weapon;
      var base = weapon === null ? 1 : cardKey(weapon) === 'pike' ? 3 : 2;
      return base + (this.march ? 2 : 0);
    }

    drawCard() {
      if (!this.pile.length && this.discard.length) {
        this.pile = shuffle(this.discard, this.random);
        this.discard = [];
      }
      return this.pile.length ? this.pile.pop() : null;
    }

    draw(player, count) {
      for (var i = 0; i < count && player.hand.length < MAX_HAND; i++) {
        var card = this.drawCard();
        if (card === null) return;
        player.hand.push(card);
      }
    }

    take(player, card) {
      player.hand.splice(player.hand.indexOf(card), 1);
      return card;
    }

    spend(player, card) { this.discard.push(this.take(player, card)); }
    randomHand(player) { return player.hand[Math.floor(this.random() * player.hand.length)]; }
    boost(player) { player.power = Math.min(3, player.power + 1); }
    used(player, skill) { return player.used[skill] === this.turn; }
    mark(player, skill) { player.used[skill] = this.turn; }

    open(type, seat, extra) {
      this.window = Object.assign({type:type, seat:seat, seq:++this.serial,
        deadline:this.clock() + timed[type]}, extra || {});
    }

    begin(index) {
      this.turn++;
      this.active = index;
      this.phase = 'prepare';
      this.attacks = 0;
      this.actions = 0;
      this.commandUsed = false;
      this.march = false;
      this.noAttack = false;
      this.noCommand = false;
      this.drawCount = 2;
      this.discardLimit = 0;
      var player = this.seats[index];
      player.ward = false;
      this.record(this.label(index) + '进入准备');
      this.jobs.push({type:'judgment'});
      if (player.hero === 'zhuge') {
        var first = this.drawCard(), second = this.drawCard();
        if (second !== null) this.open('stars', index, {look:[first, second]});
        else if (first !== null) this.pile.push(first);
      }
    }

    pump() {
      var steps = 0;
      while (!this.window && !this.result) {
        requireRule(++steps <= 128, '结算步数异常');
        if (this.jobs.length) {
          this.resolveJob(this.jobs.pop());
        } else if (this.phase === 'play') {
          if (!this.seats[this.active].alive || this.actions >= 18) this.beginDiscard();
          else this.open('play', this.active);
        } else if (this.phase === 'discard') {
          var player = this.seats[this.active];
          if (player.alive && player.hand.length > this.discardLimit) this.open('discard', this.active);
          else this.endTurn();
        } else {
          throw Error('回合无法推进');
        }
      }
    }

    resolveJob(job) {
      switch (job.type) {
        case 'judgment': return this.judgment();
        case 'draw': return this.drawPhase();
        case 'guard':
          if (this.seats[job.target].alive) {
            this.open('guard', job.target, {source:job.source, mode:job.mode, pierce:job.pierce});
          }
          return;
        default: throw Error('未知结算事件');
      }
    }

    judgment() {
      this.phase = 'judge';
      var player = this.seats[this.active];
      if (!player.delay.length) {
        this.jobs.push({type:'draw'});
        return;
      }
      var card = player.delay.shift();
      this.jobs.push({type:'judgment'});
      var rewriter = this.order(this.active, true).find(index => {
        var other = this.seats[index];
        return other.hero === 'sima' && !this.used(other, 'rewrite');
      });
      if (rewriter !== undefined) this.open('rewrite', rewriter, {order:card, target:this.active});
      else this.revealOrder(card, null);
    }

    revealOrder(order, omen) {
      if (omen === null) omen = this.drawCard();
      this.discard.push(order);
      if (omen === null) return;
      this.discard.push(omen);
      var red = deck[omen].red, key = cardKey(order);
      this.record(game.cards[key].name + '翻出' + deck[omen].suit + deck[omen].rank);
      if (key === 'edict' && red) this.noAttack = true;
      if (key === 'levy' && !red) {
        this.drawCount = Math.max(0, this.drawCount - 1);
        this.noCommand = true;
      }
    }

    drawPhase() {
      this.phase = 'draw';
      var player = this.seats[this.active];
      if (player.hero === 'liao' && this.drawCount &&
          this.order(this.active, false).some(index => this.seats[index].hand.length)) {
        this.open('harry', this.active);
      } else {
        this.draw(player, this.drawCount);
        this.phase = 'play';
      }
    }

    beginDiscard() {
      this.phase = 'discard';
      var player = this.seats[this.active];
      var careful = player.alive && player.hero === 'lu' && this.attacks === 0;
      if (careful) {
        this.boost(player);
        this.record(this.label(this.active) + '藏锋留牌');
      }
      this.discardLimit = Math.max(0, player.hp) + (careful ? 2 : 0);
    }

    endTurn() {
      this.phase = 'end';
      if (this.turn >= this.turnCap) return this.conclude('draw');
      this.begin(this.order(this.active, false)[0]);
    }

    group(source, mode) {
      var order = this.order(source, false);
      for (var i = order.length - 1; i >= 0; i--) {
        this.jobs.push({type:'guard', target:order[i], source:source, mode:mode, pierce:false});
      }
    }

    damage(target, source, pierce) {
      var player = this.seats[target];
      if (!player.alive) return;
      if (player.ward && !pierce) {
        player.ward = false;
        this.record(this.label(target) + '消耗护垒');
        return;
      }
      player.hp--;
      this.record(this.label(target) + '受到伤害');
      if (player.hero === 'cao' && !this.used(player, 'reclaim')) {
        this.mark(player, 'reclaim');
        this.draw(player, 1);
      }
      if (player.hp > 0) return;
      var rescuers = this.order(target, true);
      this.open('rescue', rescuers[0], {target:target, source:source, remaining:rescuers.slice(1)});
    }

    kill(target, source) {
      var player = this.seats[target];
      player.alive = false;
      player.ward = false;
      this.strip(player);
      this.discard.push.apply(this.discard, player.delay.splice(0));
      this.record(this.label(target) + '阵亡 · ' + game.roles[player.role]);
      var killer = this.seats[source];
      if (killer.alive && player.role === 'rebel') this.draw(killer, 2);
      if (killer.alive && killer.role === 'lord' && player.role === 'ally') this.strip(killer);
      var result = winner(this.seats);
      if (result) this.conclude(result);
    }

    strip(player) {
      this.discard.push.apply(this.discard, player.hand.splice(0));
      for (var slot of slots) {
        if (player.gear[slot] === null) continue;
        this.discard.push(player.gear[slot]);
        player.gear[slot] = null;
      }
    }

    conclude(side) {
      var winners = this.seats.filter(function(player) {
        if (side === 'court') return player.role === 'lord' || player.role === 'ally';
        return side !== 'draw' && player.role === side;
      }).map(function(player) { return player.id; });
      this.phase = 'end';
      this.result = {side:side, winners:winners};
      this.window = null;
      this.jobs.length = 0;
      this.finish(winners.length === 1 ? winners[0] : null);
    }

    breakGear(player) {
      var slot = slots.find(function(key) { return player.gear[key] !== null; });
      if (slot) {
        this.discard.push(player.gear[slot]);
        player.gear[slot] = null;
      } else if (player.delay.length) {
        this.discard.push(player.delay.shift());
      } else {
        this.spend(player, this.randomHand(player));
      }
    }

    playActions(index) {
      var player = this.seats[index], other = this.order(index, false);
      var all = [index].concat(other);
      var result = [{kind:'end-turn'}], fired = !this.noAttack && this.attacks < (this.march ? 2 : 1);
      function cardOption(card, target) {
        var action = {kind:'play', card:card};
        if (target !== undefined) action.target = target;
        result.push(action);
      }
      for (var card of player.hand) {
        var key = cardKey(card);
        if (attack(key) || (key === 'guard' && player.hero === 'zhao' && !this.used(player, 'convert'))) {
          if (fired) for (var enemy of other) {
            if (this.distance(index, enemy) <= (key === 'feint' ? 1 : this.range(player))) cardOption(card, enemy);
          }
        } else if (gear[key] || key === 'muster' || key === 'flame' || (key === 'remedy' && player.hp < player.max)) {
          cardOption(card);
        } else if (key === 'rampart') {
          for (var friend of all) if (!this.seats[friend].ward) cardOption(card, friend);
        } else {
          for (var enemy of other) {
            var target = this.seats[enemy];
            if (key === 'duel' ||
                key === 'shatter' && (target.hand.length || target.delay.length || slots.some(slot => target.gear[slot] !== null)) ||
                key === 'forage' && target.hand.length && this.distance(index, enemy) === 1 ||
                (key === 'edict' || key === 'levy') && !target.delay.some(id => cardKey(id) === key)) {
              cardOption(card, enemy);
            }
          }
        }
        this.skillActions(result, index, card, player, all, other);
      }
      if (!this.commandUsed && !this.noCommand && player.power >= 2) {
        result.push({kind:'command',choice:'march'});
        for (var ally of all) if (!this.seats[ally].ward) result.push({kind:'command',choice:'ward',target:ally});
      }
      return result;
    }

    skillActions(result, index, card, player, all, other) {
      var hero = player.hero;
      if (this.used(player, 'active')) return;
      function offer(target) {
        var action = {kind:'skill', skill:hero, card:card};
        if (target !== undefined) action.target = target;
        result.push(action);
      }
      switch (hero) {
        case 'liu': other.forEach(offer); break;
        case 'sun': if (this.discard.length) offer(); break;
        case 'zhou':
          if (player.power) other.filter(i => this.seats[i].hand.length > player.hand.length).forEach(offer);
          break;
        case 'hua':
          if (player.power) all.filter(i => this.seats[i].hp < this.seats[i].max).forEach(offer);
          break;
        case 'diao': other.filter(i => this.seats[i].hand.length).forEach(offer); break;
        case 'yuan': if (player.power >= 2 && other.length) offer(); break;
      }
    }

    options(index) {
      var w = this.window;
      if (!w || w.seat !== index || this.result) return [];
      var player = this.seats[index];
      if (w.type === 'play') return this.playActions(index);
      if (w.type === 'discard') return player.hand.map(card => ({kind:'discard',card:card}));
      var result = [{kind:'pass'}];
      if (w.type === 'harry') {
        return result.concat(this.order(index, false).filter(i => this.seats[i].hand.length)
          .map(i => ({kind:'choose',target:i})));
      }
      if (w.type === 'stars') return result.concat(w.look.map(card => ({kind:'choose',card:card})));
      if (w.type === 'scheme') {
        if (player.power) result.push({kind:'yield'});
        return result;
      }
      if (w.type === 'guard' && player.power) {
        if (w.mode === 'feint' || w.mode === 'banner') result.push({kind:'yield'});
        if (player.gear.armor !== null && !this.used(player, 'armor')) result.push({kind:'armor'});
      }
      for (var card of player.hand) {
        var key = cardKey(card), skill;
        if (player.hero === 'zhao' && !this.used(player, 'convert') &&
            (w.type === 'guard' && attack(key) || w.type === 'duel' && key === 'guard')) {
          skill = 'zhao';
        } else if (w.type === 'rescue' && key !== 'remedy' && player.hero === 'hua' && player.power &&
                   !this.used(player, 'active')) {
          skill = 'hua';
        } else if (!(w.type === 'rewrite' || w.type === 'guard' && key === 'guard' ||
                   w.type === 'duel' && attack(key) || w.type === 'rescue' && key === 'remedy')) {
          continue;
        }
        result.push(skill ? {kind:'respond', card:card, skill:skill} : {kind:'respond', card:card});
      }
      return result;
    }

    act(id, input) {
      var w = this.window, index = this.index(id);
      requireRule(w && input && index === w.seat && input.seq === w.seq && this.clock() < w.deadline,
        '行动窗口已变化或已超时');
      requireRule(Object.keys(input).every(function(key) { return key === 'seq' || actionFields.includes(key); }),
        '行动字段不合法');
      var legal = this.options(index).find(function(option) {
        return actionFields.every(function(key) { return option[key] === input[key]; });
      });
      requireRule(legal, '该行动当前不可用');
      this.resolve(w, legal);
      this.pump();
    }

    tick(time) {
      var w = this.window;
      if (!w || time < w.deadline) return false;
      if (w.type === 'discard') {
        this.window = null;
        var player = this.seats[w.seat];
        this.discard.push.apply(this.discard, player.hand.splice(this.discardLimit));
      } else {
        this.resolve(w, {kind:w.type === 'play' ? 'end-turn' : 'pass'});
      }
      this.pump();
      return true;
    }

    resolve(w, action) {
      this.window = null;
      var index = w.seat, player = this.seats[index];
      var target = this.seats[action.target], card = action.card, pass = action.kind === 'pass';
      switch (w.type) {
        case 'play':
          if (action.kind === 'end-turn') return this.beginDiscard();
          this.actions++;
          if (action.kind === 'play') return this.playCard(index, card, action.target);
          if (action.kind === 'skill') return this.useSkill(index, card, action.target);
          this.commandUsed = true;
          player.power -= 2;
          if (action.choice === 'march') this.march = true;
          else target.ward = true;
          this.record(this.label(index) + (this.march && action.choice === 'march' ? '发令强行军' : '发令立垒'));
          return;
        case 'discard':
          this.spend(player, card);
          return;
        case 'stars': {
          var chosen = pass ? w.look[0] : card;
          var remaining = w.look.find(id => id !== chosen);
          if (pass) this.pile.push(remaining, chosen);
          else {
            this.pile.unshift(remaining);
            this.pile.push(chosen);
            this.record(this.label(index) + '已观象');
          }
          return;
        }
        case 'rewrite':
          if (!pass) this.mark(player, 'rewrite');
          this.revealOrder(w.order, pass ? null : this.take(player, card));
          return;
        case 'harry':
          if (!pass) {
            player.hand.push(this.take(target, this.randomHand(target)));
            this.record(this.label(index) + '袭仓 · ' + this.label(action.target));
          }
          this.draw(player, this.drawCount - Number(!pass));
          this.phase = 'play';
          return;
        case 'scheme':
          if (!pass) player.power--;
          else if (player.hand.length) {
            var next = this.order(index, false)[0];
            this.seats[next].hand.push(this.take(player, this.randomHand(player)));
            this.record(this.label(index) + '暗转一张牌给' + this.label(next));
          }
          return;
        case 'guard':
          if (pass) return this.damage(index, w.source, w.pierce);
          if (action.kind === 'yield' || action.kind === 'armor') {
            player.power--;
            if (action.kind === 'armor') this.mark(player, 'armor');
          } else {
            this.spend(player, card);
            if (action.skill === 'zhao') this.mark(player, 'convert');
            this.boost(player);
          }
          var attacker = this.seats[w.source];
          if ((w.mode === 'thrust' || w.mode === 'feint') && attacker.gear.weapon !== null &&
              cardKey(attacker.gear.weapon) === 'blade') this.boost(attacker);
          this.record(this.label(index) + '化解来袭');
          return;
        case 'duel':
          if (pass) return this.damage(index, w.source, false);
          this.spend(player, card);
          if (action.skill === 'zhao') this.mark(player, 'convert');
          this.open('duel', w.source, {source:index});
          return;
        case 'rescue':
          if (!pass) {
            this.spend(player, card);
            if (action.skill === 'hua') {
              player.power--;
              this.mark(player, 'active');
            }
            this.seats[w.target].hp = 1;
            this.record(this.label(index) + '救回' + this.label(w.target));
          } else if (w.remaining.length) {
            this.open('rescue', w.remaining[0], {target:w.target, source:w.source, remaining:w.remaining.slice(1)});
          } else {
            this.kill(w.target, w.source);
          }
          return;
      }
    }

    playCard(index, card, targetIndex) {
      var player = this.seats[index], target = this.seats[targetIndex], key = cardKey(card);
      this.record(this.label(index) + ' · ' + game.cards[key].name +
        (target ? ' → ' + this.label(targetIndex) : ''));
      if (gear[key]) {
        var slot = gear[key], previous = player.gear[slot];
        if (previous !== null) this.discard.push(previous);
        player.gear[slot] = this.take(player, card);
      } else if (key === 'edict' || key === 'levy') {
        target.delay.push(this.take(player, card));
      } else {
        this.spend(player, card);
        if (attack(key) || key === 'guard') {
          if (key === 'guard') this.mark(player, 'convert');
          this.attacks++;
          this.jobs.push({type:'guard', mode:key === 'feint' ? 'feint' : 'thrust', target:targetIndex, source:index,
            pierce:player.gear.weapon !== null && cardKey(player.gear.weapon) === 'pike'});
        } else if (key === 'duel') {
          this.open('duel', targetIndex, {source:index});
        } else if (key === 'flame') {
          this.group(index, 'flame');
        } else if (key === 'muster') {
          this.draw(player, 2);
        } else if (key === 'remedy') {
          player.hp++;
        } else if (key === 'rampart') {
          target.ward = true;
        } else if (key === 'shatter') {
          this.breakGear(target);
        } else if (key === 'forage') {
          player.hand.push(this.take(target, this.randomHand(target)));
        }
      }
    }

    useSkill(index, card, targetIndex) {
      var player = this.seats[index], target = this.seats[targetIndex];
      this.mark(player, 'active');
      this.record(this.label(index) + '发动' + heroTable[player.hero].skill +
        (target ? ' → ' + this.label(targetIndex) : ''));
      if (player.hero === 'liu') {
        target.hand.push(this.take(player, card));
        this.boost(target);
        return;
      }
      if (player.hero === 'sun') {
        var old = this.discard.pop();
        this.spend(player, card);
        player.hand.push(old);
        return;
      }
      this.spend(player, card);
      switch (player.hero) {
        case 'zhou':
          player.power--;
          this.jobs.push({type:'guard', mode:'gale', target:targetIndex, source:index, pierce:false});
          break;
        case 'hua':
          player.power--;
          target.hp++;
          break;
        case 'diao':
          this.open('scheme', targetIndex, {source:index});
          break;
        case 'yuan':
          player.power -= 2;
          this.group(index, 'banner');
          break;
      }
    }

    publicFor() {
      var w = this.window;
      return {
        turn:this.turn, turnCap:this.turnCap, active:this.active, phase:this.phase,
        pending:w ? {type:w.type, seat:w.seat, seq:w.seq, deadline:w.deadline, remainingMs:Math.max(0, w.deadline - this.clock()), seconds:timed[w.type] / 1000,
          target:w.target === undefined ? null : w.target, source:w.source === undefined ? null : w.source,
          order:w.order === undefined ? null : w.order, mode:w.mode || ''} : null,
        pile:this.pile.length, discard:this.discard.length, top:this.discard.length ? this.discard[this.discard.length - 1] : null,
        attacks:this.attacks, attackLimit:this.noAttack ? 0 : this.march ? 2 : 1,
        discardLimit:this.phase === 'discard' ? this.discardLimit : null,
        seats:this.seats.map(seat => ({id:seat.id, hero:seat.hero, hp:seat.hp, max:seat.max, gear:Object.assign({}, seat.gear),
          delayed:seat.delay.slice(), count:seat.hand.length, ward:seat.ward, power:seat.power, alive:seat.alive,
          role:seat.role === 'lord' || !seat.alive || this.result ? seat.role : null})),
        feed:this.events.slice(), result:this.result ? {side:this.result.side, winners:this.result.winners.slice()} : null
      };
    }

    privateFor(id) {
      var index = this.index(id);
      if (index < 0) return {};
      var seat = this.seats[index];
      var w = this.window;
      if (!seat.alive) return {seat:index, role:seat.role, hand:[], options:[], look:[]};
      // Group legal actions by card/skill, rather than duplicating every target across the wire.
      var groups = Object.create(null);
      for (var option of this.options(index)) {
        var key = [option.kind,option.card,option.skill,option.choice].join('|');
        if (!groups[key]) {
          var action = Object.assign({},option);
          delete action.target;
          groups[key] = {action:action, targets:[]};
        }
        if (option.target !== undefined) groups[key].targets.push(option.target);
      }
      return {seat:index, role:seat.role, hand:seat.hand.slice(), options:Object.values(groups),
        look:w && w.seat === index && w.type === 'stars' ? w.look.slice() : []};
    }
  }

  game.create = function(info, controls) { return new Match(info, controls || {}); };
  game.roleSet = roles;
  game.winner = winner;
})(BlackmiThreeKingdoms);
