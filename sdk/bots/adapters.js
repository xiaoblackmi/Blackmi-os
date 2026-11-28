(function(api) {
  'use strict';
  function turn(m,bots,key,deadline){
    var p=m.pub,i=p.turn,id=p.players[i];
    return bots[id]?{id:id,index:i,key:key,deadline:deadline||0}:null;
  }
  api.adapters.gomoku={
    turn:(m,bots)=>turn(m,bots,m.pub.moves.length),
    view:function(m){
      var p=m.pub,actions=[];
      p.board.forEach((v,i)=>{if(!v)actions.push({kind:'place',x:i%15,y:Math.floor(i/15)});});
      return {public:{board:p.board,turn:p.turn},private:{},actions:actions};
    }
  };
  api.adapters.uno={
    turn:(m,bots)=>turn(m,bots,[m.pub.turn,m.pub.top,m.pub.drawn,m.pub.dir,m.pub.deadline].join(':'),m.pub.deadline),
    view:function(m,id){
      var p=m.pub,privateState=m.privateFor(id),actions=[];
      for(var card of privateState.hand)if(m.legal(id,card)){
        if(unoCard(card).c===-1)for(var color=0;color<4;color++)actions.push({kind:'play',card:card,color:color});
        else actions.push({kind:'play',card:card});
      }
      var fallback={kind:p.drawn?'pass':'draw'};
      if(!actions.length)actions.push(fallback);
      return {public:{turn:p.turn,dir:p.dir,color:p.color,top:p.top,counts:p.counts,drawn:p.drawn},
        private:privateState,actions:actions,fallback:actions[0]};
    }
  };
  api.adapters['three-kingdoms']={
    turn:function(m,bots){
      var w=m.rules.window,id=w&&m.pub.players[w.seat];
      if(!w||w.type==='mode'||!bots[id]||!m.rules.seats[w.seat].alive)return null;
      return {id:id,index:w.seat,key:w.seq,deadline:w.deadline};
    },
    view:function(m,id){
      var p=m.rules.publicFor(id),privateState=m.rules.privateFor(id),actions=[];
      for(var group of privateState.options){
        if(group.targets.length)group.targets.forEach(target=>actions.push(Object.assign({},group.action,{target:target,seq:p.pending.seq})));
        else actions.push(Object.assign({},group.action,{seq:p.pending.seq}));
      }
      return {public:p,private:privateState,actions:actions,fallback:actions.find(a=>['pass','end-turn','auto-discard'].includes(a.kind))};
    }
  };
  function holdemActions(p){
    var i=p.turn,actions=[{kind:'fold'},{kind:'call'}];
    var max=p.bets[i]+p.stacks[i],min=p.high+p.minRaise;
    if(!p.acted[i]&&max>p.high){
      var half=p.high+Math.max(p.minRaise,Math.floor(p.paid.reduce((a,b)=>a+b,0)/2));
      for(var to of new Set([Math.min(max,min),Math.min(max,half),Math.min(max,2*half-p.high)])){
        actions.push({kind:'raise',to:to});
      }
    }
    return actions;
  }
  api.adapters.holdem={
    turn:function(m,bots){
      var p=m.pub;
      return p.phase==='play'&&p.turn>=0&&m.eligible(p.turn)?
        turn(m,bots,[p.handNo,p.street,p.turn,p.high,p.paid.join(',')].join(':')):null;
    },
    view:function(m,id){
      var p=m.pub,privateState=m.privateFor(id),actions=holdemActions(p);
      if(p.community.length)privateState.rank=bestRank(privateState.hand.concat(p.community));
      if(p.community.length===5)privateState.boardRank=fiveRank(p.community);
      return {public:{turn:p.turn,street:p.street,community:p.community,stacks:p.stacks,bets:p.bets,paid:p.paid,
        high:p.high,folded:p.folded},private:privateState,actions:actions,fallback:p.high===p.bets[p.turn]?actions[1]:actions[0]};
    }
  };
  function kingdomLegal(m,id,a){
    var p=m.pub,i=p.players.indexOf(id);
    if(i<0||p.phase!=='play'||a.round!==p.round||now()>=p.deadline||!p.realms[i].alive||p.ready.includes(i))return false;
    if(a.kind==='ready')return true;
    if(a.kind==='accept'&&!p.offers.some(o=>o.id===a.offer&&o.to===i&&o.expires>=p.round))return false;
    try{m.plan(i,a,true);return true;}catch(e){return false;}
  }
  api.adapters.kingdoms={
    turn:function(m,bots,cursor){
      var p=m.pub,n=p.players.length;
      for(var j=0;j<n;j++){
        var i=(cursor+j)%n,id=p.players[i];
        if(bots[id]&&p.realms[i].alive&&!p.ready.includes(i))return {id:id,index:i,key:p.round+':'+m.orders[i].length,deadline:p.deadline};
      }
      return null;
    },
    legal:kingdomLegal,
    view:function(m,id){
      var p=m.publicFor(id),own=m.privateFor(id),i=p.players.indexOf(id),r=p.realms[i];
      var fallback={kind:'ready',round:p.round},actions=[fallback];
      function add(a){
        a.round=p.round;
        if(kingdomLegal(m,id,a))actions.push(a);
      }
      if(own.orders.length<4){
        p.tiles.forEach(function(tile,j){
          if(tile.owner!==i)return;
          var garrison=kSum(tile.army),near=kNeighbors(j);
          var border=near.some(k=>p.tiles[k].owner!==i&&!kAlliance(p,i,p.tiles[k].owner));
          if(border||tile.cap>=0){
            if(garrison<=27&&r.pop>=2)for(var unit=0;unit<(tile.build[2]>0?3:1);unit++)add({kind:'recruit',from:j,unit:unit});
            if(tile.build[3]<2)add({kind:'build',from:j,item:3});
          }
          if(tile.build[0]<2)add({kind:'build',from:j,item:0});
          if(tile.build[1]<2)add({kind:'build',from:j,item:1});
          if(garrison>1&&!own.orders.some(o=>o.kind==='march'&&o.from===j)){
            for(var k of near){
              var to=p.tiles[k];
              if(kAlliance(p,i,to.owner))continue;
              if(to.owner===i&&kSum(to.army)+Math.floor(garrison/2)>30)continue;
              add({kind:'march',from:j,to:k,mode:'half'});
              if(to.owner!==i||kSum(to.army)+garrison-1<=30)add({kind:'march',from:j,to:k,mode:'full'});
            }
          }
        });
        r.tech.forEach((level,item)=>{if(level<3)add({kind:'research',item:item});});
        p.offers.forEach(o=>{if(o.to===i&&p.realms[o.from].alive)add({kind:'accept',offer:o.id});});
        p.realms.forEach((realm,j)=>{
          if(i===j||!realm.alive)return;
          if(kAlliance(p,i,j))add({kind:'break',to:j});
          else if(p.round<=9&&!p.offers.some(o=>o.from===i&&o.to===j&&o.kind==='ally'))add({kind:'ally',to:j});
          if(r.gold>=6&&r.food<165&&!p.offers.some(o=>o.from===i&&o.to===j&&o.kind==='trade'))add({kind:'trade',to:j});
        });
      }
      return {public:p,private:{seat:i,orders:own.orders},actions:actions,fallback:fallback};
    }
  };
})(ArenaBots);
