(function(api) {
  'use strict';
  const {project,near,split,sum}=api.kingdomPlan;
  const weights={
    military:{attack:1.55,economy:.75,guard:1,diplomacy:.55},
    economy:{attack:.95,economy:1.55,guard:.95,diplomacy:.85},
    defense:{attack:.87,economy:1.05,guard:1.65,diplomacy:.8},
    diplomacy:{attack:1,economy:1.07,guard:1.1,diplomacy:1.85}
  };
  const terrain=[1,1.12,1.30,1.17,1.04,1.02],unknown=[4,1,1];
  const neighbors=Array.from({length:48},(_,i)=>near(i));
  function power(a,b){
    const counter=(a[0]*b[1]+a[1]*b[2]+a[2]*b[0])/Math.max(1,sum(a)*sum(b));
    return (a[0]+a[1]*1.15+a[2]*1.05)*(1+.27*counter);
  }
  function distance(a,b){return Math.abs(a%8-b%8)+Math.abs((a/8|0)-(b/8|0));}
  function situation(p,i,memory){
    if(memory.round===p.round)return memory;
    const {tiles}=p,realm=p.realms[i],land=p.ranking.find(r=>r.i===i).land;
    const allies=p.alliances.filter(a=>a.includes(i)).map(a=>a[0]===i?a[1]:a[0]);
    const capital=tiles.findIndex(t=>t.cap===i);
    const threat=j=>sum(tiles[j].army||unknown)-1;
    const hostile=j=>tiles[j].owner>=0&&tiles[j].owner!==i&&!allies.includes(tiles[j].owner);
    const danger=tiles[capital].owner!==i?30:Math.max(0,...neighbors[capital].filter(hostile).map(threat))-sum(tiles[capital].army);
    let focus=-1,value=-Infinity;
    for(let j=0;j<tiles.length;j++){
      const t=tiles[j];
      if(t.owner===i||allies.includes(t.owner)||!neighbors[j].some(k=>tiles[k].owner===i))continue;
      const score=(t.cap>=0?6:0)+(t.owner>=0?2:1)-threat(j)*terrain[t.terrain]*.27-
        distance(j,capital)*.1+(memory.focus===j?2.5:0);
      if(score>value){value=score;focus=j;}
    }
    const pressure=realm.food<18?'food':realm.gold<16?'gold':'stable';
    const route=land>=22?'conquest':land>=8&&realm.tech[2]>=2?'wealth':p.round>=15?'score':'expand';
    return {round:p.round,focus,capital,danger,pressure,allies,route};
  }
  api.observers.kingdoms=function(view,memory){
    const seat=view.realms.findIndex(r=>r.gold!==null);
    return seat<0?memory:situation(view,seat,memory);
  };
  api.strategies.kingdoms=function(c){
    const p=c.publicState,i=c.privateState.seat,orders=c.privateState.orders;
    const shadow=project(p,i,orders);
    if(!shadow)return c.legalActions[0];
    const realm=shadow.realm,tiles=p.tiles.map((_,j)=>shadow.tile(j)),allies=shadow.allies;
    const normal=c.difficulty==='normal',w=weights[c.persona]||weights.military;
    const env=situation(p,i,c.memory||{}),military=c.persona==='military';
    const own=tiles.filter(t=>t.owner===i),army=own.reduce((n,t)=>n+sum(t.army),0);
    const farms=own.reduce((n,t)=>n+t.build[0],0),maintenance=Math.ceil(army/4);
    const foodPressure=Math.max(0,maintenance-own.length*2-farms*3+8-realm.food/6)+(env.pressure==='food'?2:0);
    const diplomacyUsed=orders.some(a=>['ally','trade','accept','break'].includes(a.kind));
    const late=p.round>=15,rich=normal&&!military&&own.length>=8&&w.economy>=1.07;
    const local=tiles.map(function(tile,j){
      const adjacent=neighbors[j],foes=adjacent.filter(k=>tiles[k].owner>=0&&tiles[k].owner!==i&&!allies.includes(tiles[k].owner));
      const free=adjacent.filter(k=>tiles[k].owner!==i&&!allies.includes(tiles[k].owner)&&!shadow.attacks.has(k));
      const force=Math.max(0,...foes.map(k=>sum(tiles[k].army||unknown)-1));
      return {foes:foes.length,free:free.length,force,units:sum(tile.army||unknown),
        focus:env.focus<0?99:distance(j,env.focus)};
    });
    let best=c.legalActions[0],bestScore=0;
    for(const a of c.legalActions){
      const tile=tiles[a.from],from=local[a.from];
      let score=0;
      if(a.kind==='march'){
        const dest=tiles[a.to],to=local[a.to],units=split(tile.army,a.mode),moved=sum(units);
        if(!moved)continue;
        if(dest.owner===i){
          const need=to.force+(dest.cap===i?4:0)-to.units;
          if(from.force>=from.units-moved&&from.foes)continue;
          if(need>0)score=w.guard*(Math.min(moved,need)*.55+(dest.cap===i?2:0))-.5;
          if(normal&&from.focus>to.focus&&to.free&&(!from.free||from.units-to.units>=5)){
            score+=w.attack*Math.min(4.1,moved*.33)*(military?1.28:.8);
          }
          if(tile.cap===i&&env.danger>=0)score-=2;
        }else{
          const def=dest.army||unknown,estimatedTech=dest.owner<0?0:Math.min(3,Math.floor(p.round/5));
          const attack=power(units,def)*(1+.1*realm.tech[1])*(i===4?1.1:1);
          const defense=power(def,units)*terrain[dest.terrain]*(1+.18*(dest.build?dest.build[3]:0))*
            (1+.1*estimatedTech)*(dest.owner===5?1.1:1);
          if(attack<=defense*(normal?1.1:1.04))continue;
          const exposed=Math.max(0,from.force+(tile.cap===i?2:0)-from.units+moved);
          score=w.attack*(4.7+Math.min(3,(attack-defense)*.21)+(dest.owner>=0?1.3:0)+(dest.cap>=0?3.2:0)+
            (a.to===env.focus?1.1:0)+(env.route==='conquest'?1.1:0))-w.guard*exposed*(tile.cap===i?.69:.32)-.11*moved;
        }
      }else if(a.kind==='recruit'){
        const want=Math.max(from.force+(tile.cap===i?5:3),from.free?(military?17:11):0);
        const shortage=want-from.units;
        if(shortage<=0)continue;
        score=(w.guard+(from.free?w.attack*.35:0))*Math.min(5,shortage*.54)-
          foodPressure*.35-(a.unit===0?0:a.unit===1?1.15:.8);
        if(normal&&a.unit>0&&tile.army[a.unit]<Math.ceil(from.units/4)&&realm.gold>24&&from.free)score+=1.7;
        if(tile.cap===i&&env.danger>=0)score+=1.3;
        if(realm.food<6)score-=3;
      }else if(a.kind==='build'){
        if(a.item===3)score=w.guard*(Math.max(0,from.force-from.units*.6)*.41+(from.foes?1.1:0)+(tile.cap===i&&from.foes?1.5:0));
        if(a.item===0)score=w.economy*((late?.4:1.5)+foodPressure*.4+(realm.food<25?1.1:0));
        if(a.item===1)score=w.economy*((late?.45:1.9)+(realm.gold<30?1.3:0));
        if(a.item===2)score=from.free&&p.round<=15&&realm.gold>=10?
          w.attack*(1.4+(military?1.1:0)+(from.foes?1.4:0)+(from.focus<=1?.65:0))-
          foodPressure*.33:0;
        if(a.item<2&&rich&&realm.gold<112&&realm.food<115&&late)score-=2.2;
        if(!from.foes&&a.item<2)score+=.3;
        if(orders.filter(o=>o.kind==='build'&&o.item===a.item).length>=2)score-=2;
      }else if(a.kind==='research'){
        score=a.item===1?w.attack*(military?3.8:2.6):
          w.economy*(a.item===2?(rich||env.route==='wealth'?4.8:2):1.3+foodPressure*.45);
        if(realm.gold<13)score-=1.6;
      }else if(normal&&!diplomacyUsed){
        if(a.kind==='accept'){
          const offer=p.offers.find(o=>o.id===a.offer);
          if(offer.kind==='trade'&&realm.food>28&&realm.gold<160)score=w.diplomacy*(realm.gold<40?3:1.2);
          if(offer.kind==='ally'&&p.round<=11&&!allies.length)score=w.diplomacy*(env.danger>0?3.7:3);
        }else if(a.kind==='trade'&&realm.food<38&&p.round<16){
          score=w.diplomacy*2.3;
        }else if(a.kind==='ally'&&!allies.length&&own.length<12&&p.round<=9){
          const adjacent=tiles.some((t,j)=>t.owner===a.to&&neighbors[j].some(k=>tiles[k].owner===i));
          if(adjacent)score=w.diplomacy*(env.allies.length?1.4:2.7);
        }else if(a.kind==='break'&&p.round>=13){
          const leader=p.ranking[0],border=tiles.some((t,j)=>t.owner===a.to&&neighbors[j].some(k=>tiles[k].owner===i));
          if(border&&(leader.i===a.to||p.round>=17))score=w.attack*2.8;
        }
      }
      if(a.kind!=='ready')score-=orders.length*.46+(normal?0:.45);
      if(score>0)score+=c.random()*(normal?.24:.65);
      if(score>bestScore){bestScore=score;best=a;}
    }
    return best;
  };
})(ArenaBots);
