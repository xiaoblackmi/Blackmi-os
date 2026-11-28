(function(api) {
  'use strict';
  api.strategies.uno=function({publicState:p,privateState,legalActions,difficulty,random}){
    const hand=privateState.hand,counts=[0,0,0,0],normal=difficulty==='normal';
    hand.forEach(id=>{const c=unoCard(id).c;if(c>=0)counts[c]++;});
    let best=legalActions[0], value=-Infinity;
    for(const action of legalActions){
      if(action.kind!=='play')continue;
      const card=unoCard(action.card),wild=card.c===-1,color=wild?action.color:card.c;
      let score=random()*.3+counts[color]*.35-(wild?1.1:0);
      if(normal){
        const next=(p.turn+(card.v==='R'?-p.dir:p.dir)+p.counts.length)%p.counts.length;
        const threat=p.counts[next]<=2, stop=['+2','W4','S'].includes(card.v)||card.v==='R'&&p.counts.length===2;
        score+=counts[color]*.8-(wild?2.1:0);
        if(stop)score+=threat?7:hand.length<=3?2.5:-1.6;
        if(card.v==='R'&&p.counts.length>2)score+=p.counts[next]>p.counts[(p.turn+p.dir+p.counts.length)%p.counts.length]?1.4:-1;
      }
      if(score>value){value=score;best=action;}
    }
    return best;
  };
})(ArenaBots);
