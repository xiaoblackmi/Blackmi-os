(function(api) {
  'use strict';
  var personaWeights={
    military:{attack:1.35,economy:1,guard:1,diplomacy:.55},
    economy:{attack:.9,economy:1.5,guard:1,diplomacy:.85},
    defense:{attack:.83,economy:1.1,guard:1.55,diplomacy:.8},
    diplomacy:{attack:.9,economy:1.12,guard:1.15,diplomacy:1.8}
  };
  var terrain=[1,1.12,1.30,1.17,1.04,1.02];
  function sum(a){return a.reduce((n,v)=>n+v,0);}
  function near(i){return [i%8?i-1:-1,i%8<7?i+1:-1,i>=8?i-8:-1,i<40?i+8:-1].filter(v=>v>=0);}
  function power(a,b){
    var counter=(a[0]*b[1]+a[1]*b[2]+a[2]*b[0])/Math.max(1,sum(a)*sum(b));
    return (a[0]+a[1]*1.15+a[2]*1.05)*(1+.27*counter);
  }
  function split(a,mode){
    var n=sum(a),left=mode==='half'?Math.floor(n/2):n-1;
    var moved=a.map(v=>Math.floor(v*left/n));
    for(var j=0;sum(moved)<left&&j<9;j++)if(moved[j%3]<a[j%3])moved[j%3]++;
    return moved;
  }
  api.strategies.kingdoms=function(c){
    var p=c.publicState,i=c.privateState.seat,orders=c.privateState.orders,realm=p.realms[i];
    var normal=c.difficulty==='normal',w=personaWeights[c.persona]||personaWeights.military;
    var allies=p.alliances.filter(a=>a.includes(i)).map(a=>a[0]===i?a[1]:a[0]);
    var tiles=p.tiles,own=tiles.filter(t=>t.owner===i),army=own.reduce((n,t)=>n+sum(t.army),0);
    var farms=own.reduce((n,t)=>n+t.build[0],0),maintenance=Math.ceil(army/4);
    var foodPressure=Math.max(0,maintenance-own.length*2-farms*3+8-realm.food/6);
    var targets=new Set(orders.filter(a=>a.kind==='march'&&tiles[a.to].owner!==i).map(a=>a.to));
    var diplomacyUsed=orders.some(a=>['ally','trade','accept','break'].includes(a.kind));
    var land=p.ranking.find(r=>r.i===i).land,late=p.round>=15,rich=normal&&land>=8&&w.economy>=1.12;
    var local=tiles.map(function(tile,j){
      var adj=near(j),foes=adj.filter(k=>tiles[k].owner>=0&&tiles[k].owner!==i&&!allies.includes(tiles[k].owner));
      var open=adj.filter(k=>tiles[k].owner<0);
      var threat=foes.reduce((n,k)=>Math.max(n,sum(tiles[k].army||[4,1,1])-1),0);
      return {foes:foes.length,open:open.length,threat:threat,units:sum(tile.army||[4,1,1])};
    });
    var best=c.legalActions[0],bestScore=0;
    for(var a of c.legalActions){
      var tile=tiles[a.from],from=local[a.from],score=0;
      if(a.kind==='march'){
        var dest=tiles[a.to],to=local[a.to],units=split(tile.army,a.mode),moved=sum(units);
        if(!moved)continue;
        if(dest.owner===i){
          if(!normal||to.threat<=to.units||from.threat>=from.units-moved)continue;
          score=w.guard*(Math.min(moved,to.threat-to.units)*.37+(dest.cap===i?2:0))-.8;
        }else{
          if(targets.has(a.to))continue;
          var def=dest.army||[4,1,1],estimatedTech=dest.owner<0?0:Math.min(2,Math.floor(p.round/6));
          var attack=power(units,def)*(1+.1*realm.tech[1])*(i===4?1.1:1);
          var defense=power(def,units)*terrain[dest.terrain]*(1+.18*(dest.build?dest.build[3]:0))*
            (1+.1*estimatedTech)*(dest.owner===5?1.1:1);
          if(attack<=defense*(normal?1.13:1.04))continue;
          var exposed=Math.max(0,from.threat+1-from.units+moved);
          score=w.attack*(4+Math.min(2,(attack-defense)*.24)+(dest.owner>=0?1.3:0)+(dest.cap>=0?2.6:0))-
            w.guard*exposed*(tile.cap===i?.55:.26)-.13*moved;
        }
      }else if(a.kind==='recruit'){
        var shortage=(from.threat+3-from.units)+(from.open?6:0)+(tile.cap===i?2:0);
        score=w.guard*(Math.min(4,shortage*.65)+(from.foes?1.5:0))-
          foodPressure*.24-(a.unit===0?0:a.unit===1?1.15:.8);
        if(normal&&a.unit>0&&from.foes&&tile.army[a.unit]<2&&realm.gold>25)score+=1.4;
        if(realm.food<6)score-=3;
      }else if(a.kind==='build'){
        if(a.item===3)score=w.guard*(Math.max(0,from.threat-from.units*.6)*.42+(from.foes?1.1:0)+(tile.cap===i&&from.foes?1.2:0));
        if(a.item===0)score=w.economy*((late?.35:1.5)+foodPressure*.34+(realm.food<25?1.25:0));
        if(a.item===1)score=w.economy*((late?.35:1.9)+(realm.gold<30?1.5:0));
        if(a.item!==3&&rich&&realm.gold<112&&realm.food<115&&late)score-=2.2;
        if(!from.foes&&a.item!==3)score+=.3;
        if(orders.filter(o=>o.kind==='build'&&o.item===a.item).length>=2)score-=2;
      }else if(a.kind==='research'){
        score=w.economy*(a.item===2?(rich?4.7:2.1):a.item===1?(normal?3:1.9):1.3+foodPressure*.45);
        if(a.item===1&&land>=5)score+=w.attack*.55;
        if(realm.gold<13)score-=1.6;
      }else if(normal&&!diplomacyUsed){
        if(a.kind==='accept'){
          var offer=p.offers.find(o=>o.id===a.offer);
          if(offer.kind==='trade'&&realm.food>28&&realm.gold<170)score=w.diplomacy*(realm.gold<40?2.5:1.2);
          if(offer.kind==='ally'&&p.round<=11&&!allies.length&&p.realms[offer.from].alive)score=w.diplomacy*2.9;
        }else if(a.kind==='trade'&&realm.food<32&&p.round<16){
          score=w.diplomacy*1.9;
        }else if(a.kind==='ally'&&!allies.length&&land<12&&p.round<=9){
          var adjacent=tiles.some((t,j)=>t.owner===a.to&&near(j).some(k=>tiles[k].owner===i));
          if(adjacent)score=w.diplomacy*2.3;
        }else if(a.kind==='break'&&p.round>=13){
          var leader=p.ranking[0],border=tiles.some((t,j)=>t.owner===a.to&&near(j).some(k=>tiles[k].owner===i));
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
