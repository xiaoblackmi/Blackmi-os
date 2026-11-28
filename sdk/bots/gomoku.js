(function(api){
  'use strict';
  const rays=[[1,0],[0,1],[1,1],[1,-1]];
  const weights=[0,3,28,155,950,90000];
  function span(board,id,stone){
    const x=id%15,y=(id/15)|0;
    let points=0,forks=0;
    for(const [dx,dy] of rays){
      let length=1,ends=0,jump=0;
      for(const sign of [1,-1]){
        let a=x+dx*sign,b=y+dy*sign;
        while(a>=0&&a<15&&b>=0&&b<15&&board[b*15+a]===stone){
          length++;a+=dx*sign;b+=dy*sign;
        }
        if(a>=0&&a<15&&b>=0&&b<15&&!board[b*15+a]){
          ends++;
          a+=dx*sign;b+=dy*sign;
          if(a>=0&&a<15&&b>=0&&b<15&&board[b*15+a]===stone)jump++;
        }
      }
      if(length>=5)return 90000;
      if(ends){
        points+=weights[length]*(ends===2?2.7:1);
        if(length>=3&&(ends===2||length===4))forks++;
        if(length>=2&&jump)points+=weights[length+1]*.42;
      }
    }
    return points+Math.max(0,forks-1)*580;
  }
  function score(board,id,stone){
    return span(board,id,stone)+1.07*span(board,id,3-stone)+.025*(14-Math.abs(id%15-7)-Math.abs((id/15|0)-7));
  }
  function wins(board,stone){
    const out=[];
    for(let id=0;id<225;id++){
      if(board[id])continue;
      const x=id%15,y=id/15|0;
      for(const [dx,dy] of rays){
        let run=1;
        for(const sign of [1,-1]){
          let a=x+dx*sign,b=y+dy*sign;
          while(a>=0&&a<15&&b>=0&&b<15&&board[b*15+a]===stone){
            run++;a+=dx*sign;b+=dy*sign;
          }
        }
        if(run>=5){out.push(id);break;}
      }
    }
    return out;
  }
  function candidates(board,stone,limit){
    const frontier=new Set();
    for(let id=0;id<225;id++)if(board[id]){
      const x=id%15,y=id/15|0;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const a=x+dx,b=y+dy;
        if(a>=0&&a<15&&b>=0&&b<15&&!board[b*15+a])frontier.add(b*15+a);
      }
    }
    if(!frontier.size&&!board[112])frontier.add(112);
    return Array.from(frontier,id=>({id,value:score(board,id,stone)}))
      .sort((a,b)=>b.value-a.value||a.id-b.id).slice(0,limit);
  }
  api.strategies.gomoku=function({publicState,legalActions,difficulty,random}){
    const board=publicState.board.slice(),mine=publicState.turn+1,enemy=3-mine;
    const find=id=>legalActions.find(a=>a.x===id%15&&a.y===(id/15|0));
    const own=wins(board,mine),block=wins(board,enemy);
    if(own.length)return find(own[0]);
    if(block.length)return find(block[0]);
    const ranked=candidates(board,mine,8);
    if(!ranked.length)return legalActions[0];
    if(difficulty==='easy'){
      const close=ranked.slice(0,3).filter(x=>x.value>=ranked[0].value*.7);
      return find(close[Math.floor(random()*close.length)].id);
    }
    const start=performance.now(),limit=3.4;
    let best=ranked[0].id,alpha=-Infinity,nodes=0,complete=best;
    // Root plus a bounded opponent ply. A cutoff keeps the completed one-ply answer.
    for(const root of ranked){
      if(nodes>=48||performance.now()-start>limit)return find(complete);
      board[root.id]=mine;
      const double=wins(board,mine).length>=2;
      const replies=candidates(board,enemy,6);
      let worst=double?60000:root.value;
      if(!double)for(const reply of replies){
        nodes++;
        worst=Math.min(worst,root.value-reply.value*.86);
        if(worst<=alpha)break;
      }
      board[root.id]=0;
      if(worst>alpha){alpha=worst;best=root.id;}
    }
    return find(best);
  };
})(ArenaBots);
