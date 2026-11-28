(function(factory){
  const policy=factory();
  if(typeof module==='object'&&module.exports)module.exports=policy;
  else ArenaBots.strategies['three-kingdoms']=function(input){
    const game=globalThis.BlackmiThreeKingdoms;
    const names=Object.fromEntries(game.heroes.map(hero=>[hero.id,hero.name]));
    const action=policy.decide({deck:game.deck},names,input.publicState,input.privateState,input.random,input.difficulty,input.memory);
    return action?Object.assign({},action,{seq:input.publicState.pending.seq}):null;
  };
  if(typeof ArenaBots!=='undefined')ArenaBots.adapters['three-kingdoms'].observe=function(view,memory){
    const names=Object.fromEntries(globalThis.BlackmiThreeKingdoms.heroes.map(hero=>[hero.id,hero.name]));
    return policy.remember(view,names,memory);
  };
})(function(){
'use strict';
const offensive = ['进锋', '佯攻', '论阵', '破械', '截粮', '沉锋令', '迟援帖', '借风', '离席计'];

function suspicion(view, heroName, lord) {
  if (lord < 0) return view.seats.map(() => 0);
  const target = ' → ' + heroName[view.seats[lord].hero];
  return view.seats.map(seat => {
    const name = heroName[seat.hero];
    let score = 0;
    for (const line of view.feed) {
      if (!line.startsWith(name) || !line.endsWith(target)) continue;
      if (offensive.some(effect => line.includes(effect))) score += 2;
      if (['协防','授策','行医'].some(effect => line.includes(effect))) score -= 2;
    }
    return Math.max(-4,Math.min(4,score));
  });
}

function decide(game, names, view, self, random, difficulty, memory) {
  const seats = view.seats, seat = seats[self.seat], w = view.pending;
  const lord = seats.findIndex(other => other.role === 'lord');
  const alive = seats.filter(other => other.alive).length;
  const normal = difficulty !== 'easy';
  const lean = normal ? suspicion(view,names,lord).map((value,i) =>
    Math.max(-4,Math.min(4,value + (memory&&memory.lean ? memory.lean[i]*.45 : 0)))) : seats.map(()=>0);
  const attacks = self.hand.filter(id => ['thrust','feint'].includes(game.deck[id].key)).length;

  function enemy(index) {
    if (index === self.seat) return -16;
    if (self.role === 'rebel') return index === lord ? 9 : -1.8 - lean[index]*.65;
    if (self.role === 'rogue') {
      if (index === lord) return alive === 2 ? 10 : -8;
      return 2.6 + Math.max(0,lean[index])*.6 + (normal ? seats[index].hp*.12 : 0);
    }
    return index === lord ? -15 : 1.1 + lean[index]*.95;
  }

  function spare(key) {
    if (key === 'remedy') return seat.hp <= 2 ? 5 : 3;
    if (key === 'guard') return self.hand.filter(id => game.deck[id].key==='guard').length < 2 ? 4 : 1.2;
    return ['muster','pike','armor','thrust'].includes(key) ? 2.3 : 1;
  }

  function score(action) {
    const key = action.card === undefined ? '' : game.deck[action.card].key;
    const target = action.target === undefined ? null : seats[action.target];
    const rival = target ? enemy(action.target) : 0;
    const cost = normal ? spare(key) : key==='remedy'||key==='guard' ? 2 : 1;
    switch (action.kind) {
      case 'resume': return 40;
      case 'set-mode': return -Infinity;
      case 'end-turn': return 0;
      case 'auto-discard': return -8;
      case 'discard': return 6 - cost;
      case 'pass':
        if (w.type === 'rescue' || w.type === 'rewrite') return 1;
        return 0;
      case 'yield': return w.type === 'scheme' ? 2.2 : 6;
      case 'armor': return 8;
      case 'respond': {
        if (w.type === 'rewrite') {
          const flipsRed = game.deck[action.card].red;
          const delaysAttack = game.deck[w.order].key === 'edict';
          const harms = flipsRed === delaysAttack;
          const preference = harms ? enemy(w.target) : -enemy(w.target);
          return preference*.7 - cost*.25;
        }
        if (w.type === 'rescue') return -enemy(w.target)*1.25 - cost*.3 + (w.target===self.seat ? 8 : 0);
        if (normal && w.type === 'guard' && seat.ward && !w.pierce) return -.4;
        if (normal && w.type === 'duel' && seat.ward && attacks<2) return -.3;
        return 10 - cost*.4;
      }
      case 'choose': return target ? 1.5 + rival*.66 : 2 + cost*.3;
      case 'command':
        return action.choice === 'march' ? (attacks>=2 && view.attacks===0 ? 3.2 : -.8) :
          1.4 - rival*.4 + (target.hp<=2 ? 2 : 0);
      case 'skill':
        if (action.skill === 'liu' || action.skill === 'hua') {
          return -rival*.6 - cost*.35 + (action.skill==='hua' && target.hp<=2 ? 2.6 : 0);
        }
        if (action.skill === 'sun') return spare(game.deck[view.top].key)-cost-.2;
        if (action.skill === 'yuan') return seats.reduce((n,other,i) =>
          n + (other.alive && i!==self.seat ? enemy(i) : 0),0)*.6-cost-1;
        return rival*.66 - cost*.6;
      case 'play':
        if (['thrust','feint','duel'].includes(key) || key==='guard' && target) {
          return rival + (normal ? (target.hp<=2 ? 1.35 : 0) - Number(target.ward)*1.6 : 0) -
            (key==='duel' && attacks<2 ? 2 : 0);
        }
        if (key==='muster') return 7;
        if (key==='remedy') return seat.hp<=2 ? 13 : 6;
        if (key==='rampart') return 1.4-rival*.42 + Number(target.hp<=2)*1.6;
        if (key==='flame') return seats.reduce((n,other,i) =>
          n + (other.alive && i!==self.seat ? enemy(i) - Number(other.ward)*.9 : 0),0)*.67-1;
        if (['blade','pike','armor','charge','shelter'].includes(key)) {
          const slot = ['blade','pike'].includes(key) ? 'weapon' : key;
          const wearing = seat.gear[slot];
          return wearing===null ? 3.8 : key==='pike' && game.deck[wearing].key==='blade' ? 3.1 : -1;
        }
        return rival*.6 + (key==='forage' ? 1.4 : 0);
      default: return -Infinity;
    }
  }

  let best, bestScore=-Infinity;
  for (const group of self.options) {
    const inputs = group.targets.length ? group.targets.map(target=>({...group.action,target})) : [group.action];
    for (const a of inputs) {
      const value=score(a)+(random()-.5)*(normal ? .85 : 1.1);
      if (value>bestScore) {bestScore=value;best=a;}
    }
  }
  return best;
}

function remember(view, names, memory) {
  const stamp=view.feed.join('|');
  if(memory.stamp===stamp)return memory;
  const lord=view.seats.findIndex(seat=>seat.role==='lord');
  const raw=suspicion(view,names,lord);
  return {stamp:stamp,lean:raw.map((value,i)=>Math.max(-3,Math.min(3,value*.5+(memory.lean?memory.lean[i]*.65:0))))};
}

return {decide,remember};
});
