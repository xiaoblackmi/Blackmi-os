(function(api){
  'use strict';
  function opening(hand){
    const a=Math.floor(hand[0]/4)+2,b=Math.floor(hand[1]/4)+2;
    const hi=Math.max(a,b),lo=Math.min(a,b),gap=hi-lo;
    if(!gap)return .47+hi*.032;
    return Math.min(.85,.10+(hi-2)*.032+(lo-2)*.017+(hand[0]%4===hand[1]%4? .075:0)+
      (gap<=2? .046:0)+(hi>=11&&lo>=10? .065:0));
  }
  function made(rank,boardRank,hand,board){
    const category=rank[0],hi=Math.max(...hand.map(x=>Math.floor(x/4)+2));
    let score=[.15,.52,.64,.72,.80,.87,.94,.98,1][category]+(rank[1]||hi)*.006;
    if(boardRank&&category===boardRank[0]&&rank.every((v,i)=>v===boardRank[i]))score-=.29;
    if(category===1&&board.some(a=>hand.some(b=>Math.floor(a/4)===Math.floor(b/4))))score+=.055;
    if(board.length<5&&category<=1){
      const suits=[0,0,0,0];
      board.concat(hand).forEach(c=>suits[c%4]++);
      if(suits.includes(4))score+=.085;
      const ranks=new Set(board.concat(hand).map(c=>Math.floor(c/4)+2));
      if(ranks.has(14))ranks.add(1);
      for(let start=1;start<=10;start++){
        let found=0;
        for(let offset=0;offset<5;offset++)if(ranks.has(start+offset))found++;
        if(found===4){score+=.045;break;}
      }
    }
    return Math.min(1,score);
  }
  api.strategies.holdem=function({publicState:p,privateState:me,legalActions,difficulty,persona,random}){
    const i=p.turn,owed=Math.min(p.stacks[i],Math.max(0,p.high-p.bets[i]));
    const pot=p.paid.reduce((a,b)=>a+b,0),live=p.folded.filter(x=>!x).length;
    const bold=persona==='bold',normal=difficulty==='normal';
    const raw=p.community.length?made(me.rank,me.boardRank,me.hand,p.community):opening(me.hand);
    const score=raw+(bold? .045:-.015)-(live-2)*(normal? .026:.01);
    const fold=legalActions.find(a=>a.kind==='fold'),call=legalActions.find(a=>a.kind==='call');
    const raises=legalActions.filter(a=>a.kind==='raise');
    const odds=owed/(pot+owed||1),load=owed/(p.stacks[i]||1);
    const pressure=normal ? Math.max(.22,.17+odds*.69+load*.30) : .36+load*.27;
    if(owed&&score<pressure)return fold;
    let raiseAt=p.street==='preflop'? .73:.79;
    if(!normal)raiseAt+=.035;
    if(bold)raiseAt-=.09;
    const bluff=normal&&bold&&!owed&&live<=3&&pot<=130&&score>.19&&random()<.06;
    if(raises.length&&(score>raiseAt||bluff)){
      const min=raises[0],other=raises[Math.min(raises.length-1,score>.91?2:1)];
      return bluff||!normal||!bold&&score<.89?min:other;
    }
    return call;
  };
})(ArenaBots);
