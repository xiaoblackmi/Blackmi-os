(function(api){
  'use strict';
  const size=15,area=size*size,center=112,axes=[[1,0],[0,1],[1,1],[1,-1]];
  const lines=new Int16Array(area*36);
  for(let id=0;id<area;id++)for(let axis=0;axis<axes.length;axis++){
    const [dx,dy]=axes[axis],x=id%size,y=id/size|0,at=id*36+axis*9;
    for(let n=-4;n<=4;n++){
      const a=x+n*dx,b=y+n*dy;
      lines[at+n+4]=a>=0&&a<size&&b>=0&&b<size?b*size+a:-1;
    }
  }
  const counts=new Uint8Array(512),windowValues=[20000,750,56,8,1];
  for(let i=1;i<counts.length;i++)counts[i]=counts[i>>1]+(i&1);
  function winsAt(board,id,stone){
    for(let at=id*36,end=at+36;at<end;at+=9){
      let run=1;
      for(let n=3;n>=0&&board[lines[at+n]]===stone;n--)run++;
      for(let n=5;n<9&&board[lines[at+n]]===stone;n++)run++;
      if(run>=5)return true;
    }
    return false;
  }
  function pattern(board,id,stone,finishes){
    let fours=0,threes=0,score=0;
    for(let at=id*36,end=at+36;at<end;at+=9){
      let own=16,empty=0,best=0,win=0,three=0;
      for(let n=0;n<9;n++){
        const occupant=board[lines[at+n]];
        if(occupant===stone)own|=1<<n;
        if(occupant===0&&n!==4)empty|=1<<n;
      }
      for(let n=0;n<=4;n++){
        const window=31<<n;
        if(((own|empty)&window)!==window)continue;
        const gaps=window&empty,count=counts[gaps];
        if(count===1)win|=gaps;
        if(count<5)best=Math.max(best,windowValues[count]);
      }
      if(win){
        const openings=counts[win];
        fours+=openings;
        score+=openings===1?750:3000;
        if(finishes)for(let n=0;n<9;n++)if(win&(1<<n))finishes.push(lines[at+n]);
      }else{
        // A live three has a continuation to four stones with both ends open.
        for(let n=0;n<4;n++){
          const ends=33<<n,inside=30<<n;
          if((inside&16)&&(empty&ends)===ends&&((own|empty)&inside)===inside&&counts[empty&inside]===1)three++;
        }
        if(three)threes++;
        score+=three?200+Math.min(three,3)*18:best;
      }
    }
    if(fours&&threes)score+=620;
    if(threes>=2)score+=500+150*(threes-2);
    return score;
  }
  function initial(board,mine,enemy,legal){
    let win=-1,block=-1;
    // Both colors get an exhaustive five/overline scan before optional work.
    for(let id=0;id<area;id++)if(legal[id]){
      if(win<0&&winsAt(board,id,mine))win=id;
      if(block<0&&winsAt(board,id,enemy))block=id;
    }
    return win>=0?win:block;
  }
  function rank(board,mine,enemy,legal,expired){
    const candidates=[];
    // Only positions next to a stone can participate in the early fighting.
    for(let id=0;id<area;id++){
      if((id&7)===0&&expired())break;
      if(!legal[id])continue;
      const x=id%size,y=id/size|0,central=14-Math.abs(x-7)-Math.abs(y-7);
      let adjacent=false;
      for(let dy=-2;dy<=2&&!adjacent;dy++){
        const b=y+dy;
        if(b<0||b>=size)continue;
        for(let a=Math.max(0,x-2);a<=Math.min(size-1,x+2);a++)if(board[b*size+a]){adjacent=true;break;}
      }
      if(!adjacent)continue;
      const attack=pattern(board,id,mine),defense=pattern(board,id,enemy);
      candidates.push({id,attack,defense,value:attack+defense*.82+central*.12});
    }
    return candidates.sort((a,b)=>b.value-a.value||a.id-b.id);
  }
  function forced(board,move,mine,enemy,depth,required,frontier,budget){
    if(required>=0&&move!==required||!budget.take())return false;
    board[move]=mine;
    const threats=[];
    pattern(board,move,mine,threats);
    let proof=threats.length>=2;
    if(threats.length===1&&depth>1){
      const reply=threats[0];
      board[reply]=enemy;
      const counters=[];
      pattern(board,reply,enemy,counters);
      // A counter-four can itself force the next stone. Two ends refute this line.
      if(counters.length===1)proof=forced(board,counters[0],mine,enemy,depth-1,counters[0],frontier,budget);
      if(!counters.length){
        const next=[];
        for(const spot of frontier){
          if(budget.expired())break;
          if(!board[spot])next.push({spot,value:pattern(board,spot,mine)});
        }
        next.sort((a,b)=>b.value-a.value||a.spot-b.spot);
        for(const a of next.slice(0,5)){
          if(a.value<750||budget.expired())break;
          if(forced(board,a.spot,mine,enemy,depth-1,-1,frontier,budget)){proof=true;break;}
        }
      }
      board[reply]=0;
    }
    board[move]=0;
    return proof;
  }
  api.strategies.gomoku=function({publicState,legalActions,difficulty,random}){
    const deadline=performance.now()+4,board=publicState.board.slice(),mine=publicState.turn+1,enemy=3-mine;
    let nodes=0;
    const budget={expired:()=>nodes>=52||performance.now()>=deadline,take(){
      if(this.expired())return false;
      nodes++;return true;
    }};
    const legal=[];
    for(const a of legalActions)legal[a.y*size+a.x]=a;
    const urgent=initial(board,mine,enemy,legal);
    if(urgent>=0)return legal[urgent];
    const ranked=rank(board,mine,enemy,legal,budget.expired);
    if(!ranked.length)return legal[center]||legalActions[0];
    if(difficulty==='easy'){
      const close=ranked.slice(0,3).filter(a=>a.value>=ranked[0].value*.78);
      return legal[close[Math.floor(random()*close.length)].id];
    }
    const frontier=ranked.slice(0,24).map(a=>a.id);
    const danger=ranked.filter(a=>a.defense>=500).sort((a,b)=>b.defense-a.defense).slice(0,5);
    let best=ranked[0].id,value=-Infinity;
    for(const root of ranked.slice(0,10)){
      if(budget.expired())break;
      if(root.attack>=750&&forced(board,root.id,mine,enemy,4,-1,frontier,budget))return legal[root.id];
      if(budget.expired())break;
      board[root.id]=mine;
      let risk=0;
      // A forcing four takes away the opposing side's quiet reply.
      if(root.attack<750)for(const rival of danger){
        if(!board[rival.id])risk=Math.max(risk,pattern(board,rival.id,enemy));
      }
      board[root.id]=0;
      const score=root.value-risk*.66;
      if(score>value){value=score;best=root.id;}
    }
    return legal[best];
  };
})(ArenaBots);
