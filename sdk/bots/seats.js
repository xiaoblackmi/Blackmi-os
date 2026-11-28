(function() {
  'use strict';
  function profiles(kind){return ArenaBots.personas[kind]||[];}
  Lobby.prototype.botSetup=function(){
    var p=this.setup;
    check(this.role==='host'&&this.idle()&&p&&ArenaBots.supports(p.kind),'只有房主可以调整当前人机座位');
    return p;
  };
  Lobby.prototype.configureBot=function(slot,field,value){
    var p=this.botSetup();
    check(integer(slot,0,p.seats.length-1),'座位无效');
    var bot=this.botManager.setup[p.seats[slot]];
    if(field==='add'){
      check(!p.seats[slot],'请先腾出该座位');
      p.seats[slot]=this.botManager.create(p.kind,slot).id;
    }else if(field==='remove'){
      check(bot,'该座位没有 AI');
      p.seats[slot]=null;
    }else if(field==='difficulty'){
      check(bot&&['easy','normal'].includes(value),'难度无效');
      bot.difficulty=value;
    }else{
      check(field==='persona'&&bot&&profiles(p.kind).includes(value),'性格无效');
      bot.persona=value;
    }
    this.error='';
    this.botManager.refresh();
    this.roster();
  };
  Lobby.prototype.fillBots=function(total){
    var p=this.botSetup();
    check(integer(total,minPlayers(p.kind),p.seats.length),'目标人数超出游戏限制');
    var count=p.seats.filter(Boolean).length;
    check(count<=total,'当前人数已超过目标，请先腾出座位');
    check(p.seats.some(id=>id&&this.players.some(member=>member.id===id)),'请先让一名真人入座');
    if(p.kind==='holdem'||p.kind==='three-kingdoms'&&!p.seats.includes(this.me)){
      check(p.seats[0]&&this.players.some(member=>member.id===p.seats[0]),'请先安排 1 号席真人');
    }
    for(var i=0;i<p.seats.length&&count<total;i++)if(!p.seats[i]){
      p.seats[i]=this.botManager.create(p.kind,i).id;
      count++;
    }
    this.error='';
    this.botManager.refresh();
    this.roster();
  };
  Lobby.prototype.soloBots=function(kind){
    check(!this.role&&ArenaBots.supports(kind),'已有房间，请从准备界面添加 AI');
    this.create('玩家');
    this.prepare(kind);
    this.setup.seats[0]=this.me;
    this.setup.ready=[this.me];
    this.fillBots(minPlayers(kind));
    this.start(kind);
  };
})();

function arenaMember(lobby,id,setup){
  var person=lobby.players.find(member=>member.id===id);
  if(person)return person;
  var state=setup||lobby.state||lobby.setup;
  return state&&(state.bots||[]).find(bot=>bot.id===id);
}
function arenaName(person){
  return person?person.name+(person.difficulty?(person.difficulty==='easy'?' · 简单':' · 普通'):''):'已离开成员';
}
function arenaSeatTools(kind,p,host){
  if(!ArenaBots.supports(kind))return '';
  var bots=p.bots||[];
  var html='<div class="arena-setup"><b>'+ (p.seats.filter(Boolean).length-bots.length)+' 真人 · '+bots.length+' AI</b>';
  if(host){
    html+='<select data-bot-total aria-label="自动补位人数"><option value="">自动补 AI…</option>'+
      Array.from({length:p.seats.length-minPlayers(kind)+1},(_,i)=>{
        var n=minPlayers(kind)+i;return '<option value="'+n+'">补到 '+n+' 人</option>';
      }).join('')+'</select>';
    if(kind==='holdem'||kind==='three-kingdoms'&&!p.seats.includes(service.me))html+='<small>混合局 1 号席由真人担任</small>';
  }
  return html+'</div>';
}
function arenaBotTools(kind,i,person,host){
  if(!host||!ArenaBots.supports(kind))return '';
  if(!person)return btn('bot-add:'+i,'＋AI');
  if(!person.difficulty)return '';
  var levels=['easy','normal'].map(k=>'<option value="'+k+'" '+(person.difficulty===k?'selected':'')+'>'+
    (k==='easy'?'简单':'普通')+'</option>').join('');
  var style=ArenaBots.personas[kind];
  return '<div class="arena-seat-tools"><select aria-label="AI 难度" data-bot-level="'+i+'">'+levels+'</select>'+
    (style?'<select aria-label="AI 性格" data-bot-persona="'+i+'">'+style.map(k=>'<option value="'+k+'" '+
      (person.persona===k?'selected':'')+'>'+ArenaBots.labels[k]+'</option>').join('')+'</select>':'')+
    btn('bot-remove:'+i,'移除')+'</div>';
}
