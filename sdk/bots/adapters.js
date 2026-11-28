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
  api.turn=turn;
})(ArenaBots);
