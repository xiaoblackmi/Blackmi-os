(function(api){
  'use strict';
  const costs=[[4,3,2],[6,5,2],[5,3,2]],buildCosts=[5,6,7,6];
  const sum=a=>a[0]+a[1]+a[2];
  const near=i=>[i%8?i-1:-1,i%8<7?i+1:-1,i>=8?i-8:-1,i<40?i+8:-1].filter(v=>v>=0);
  function split(a,mode){
    const total=sum(a),count=mode==='half'?Math.floor(total/2):total-1;
    const moved=a.map(v=>Math.floor(v*count/Math.max(1,total)));
    for(let j=0;sum(moved)<count&&j<9;j++)if(moved[j%3]<a[j%3])moved[j%3]++;
    return moved;
  }
  function project(p,seat,orders,extra){
    const own=p.realms[seat],r={gold:own.gold,food:own.food,pop:own.pop,tech:own.tech.slice()};
    // Another country can accept our already-visible trade before construction starts.
    const reserved=p.offers.filter(o=>o.from===seat&&o.kind==='trade'&&o.expires>=p.round&&p.realms[o.to].alive).length*6;
    r.gold=Math.max(0,r.gold-reserved);
    const patches=Object.create(null),attacks=new Set(),list=extra?orders.concat(extra):orders;
    const allies=p.alliances.filter(a=>a.includes(seat)).map(a=>a[0]===seat?a[1]:a[0]);
    const tile=i=>patches[i]||p.tiles[i];
    function edit(i){
      if(!patches[i]){
        const t=p.tiles[i];patches[i]=Object.assign({},t,{army:t.army.slice(),build:t.build.slice()});
      }
      return patches[i];
    }
    function pay(gold,food,pop){
      if(r.gold<gold||r.food<food||r.pop<pop)return false;
      r.gold-=gold;r.food-=food;r.pop-=pop;return true;
    }
    for(const a of list){
      if(a.kind==='break'){
        const index=allies.indexOf(a.to);
        if(index>=0)allies.splice(index,1);
      }
      if(a.kind==='accept'){
        const offer=p.offers.find(o=>o.id===a.offer&&o.to===seat);
        if(!offer||offer.expires<p.round||!p.realms[offer.from].alive)return null;
        if(offer.kind==='ally'&&!allies.includes(offer.from))allies.push(offer.from);
        if(offer.kind==='trade'){
          // The sender's resources are private. Reserve the food without spending conditional trade income.
          if(r.gold>174||!pay(0,8,0))return null;
        }
      }
    }
    for(const a of list){
      if(a.kind==='research'){
        if(r.tech[a.item]>=3||!pay(7+r.tech[a.item]*3-(seat===7?2:0),3,0))return null;
        r.tech[a.item]++;
      }else if(a.kind==='recruit'||a.kind==='build'){
        const t=edit(a.from);
        if(a.kind==='build'){
          if(t.build[a.item]>=2||!pay(buildCosts[a.item]-(seat===3?1:0),a.item===0?1:2,0))return null;
          t.build[a.item]++;
        }else{
          const count=sum(t.army);
          if(count>27||a.unit!==0&&!t.build[2]||!pay(...costs[a.unit]))return null;
          t.army[a.unit]+=Math.min(30-count,a.unit===0?(seat===2?4:3):2);
        }
      }
    }
    for(const a of list){
      if(a.kind!=='march')continue;
      const from=edit(a.from),dest=tile(a.to),army=split(from.army,a.mode),count=sum(army);
      if(count<1||allies.includes(dest.owner))return null;
      if(dest.owner===seat){
        if(sum(dest.army)+count>30)return null;
        const target=edit(a.to);
        for(let j=0;j<3;j++)target.army[j]+=army[j];
      }else{
        if(attacks.has(a.to))return null;
        attacks.add(a.to);
      }
      // Hostile combat is uncertain. Commit departing troops and reserve the target.
      for(let j=0;j<3;j++)from.army[j]-=army[j];
    }
    return {tile,realm:r,allies,attacks};
  }
  api.kingdomPlan={project,near,split,sum};
})(ArenaBots);
