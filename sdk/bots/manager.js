var ArenaBots = (function() {
  'use strict';
  var strategies=BlackmiArenaPolicies.strategies, adapters=Object.create(null);
  var personas={holdem:['steady','bold'],kingdoms:['military','economy','defense','diplomacy']};
  var labels={steady:'保守',bold:'积极',military:'扩张',economy:'经济',defense:'防御',diplomacy:'外交'};
  function same(a,b){
    if(!a||typeof a!=='object')return false;
    var keys=Object.keys(b);
    return Object.keys(a).length===keys.length&&keys.every(k=>a[k]===b[k]);
  }
  function isolate(data){return freezeGameView(copy(data));}
  class Manager {
    constructor(lobby) {
      this.lobby=lobby;
      this.random=Math.random;
      this.sequence=0;
      this.clear();
    }
    clear() {
      this.pending=null;
      this.setup=Object.create(null);
      this.active=Object.create(null);
      this.cursor=0;
    }
    clearSetup(){this.setup=Object.create(null);}
    stop(){this.pending=null;this.active=Object.create(null);this.cursor=0;}
    create(kind,slot,level,persona){
      var options=personas[kind]||[];
      var suffix=('00000000'+(this.sequence++>>>0).toString(16)).slice(-8);
      var id='bot-'+uid().slice(0,16)+suffix;
      check(!this.setup[id]&&!this.active[id]&&!this.lobby.players.some(p=>p.id===id),'AI 座位编号冲突');
      return this.setup[id]={id:id,name:'AI '+(slot+1),difficulty:level||'normal',
        persona:persona||options[slot%options.length]||''};
    }
    refresh(){
      var setup=this.lobby.setup;
      if(!setup)return;
      for(var id of Object.keys(this.setup))if(!setup.seats.includes(id))delete this.setup[id];
      var bots=setup.seats.reduce((list,id,i)=>{
        if(this.setup[id]){
          this.setup[id].name='AI '+(i+1);
          list.push(Object.assign({},this.setup[id]));
        }
        return list;
      },[]);
      if(bots.length)setup.bots=bots;
      else delete setup.bots;
      setup.ready=setup.ready.filter(id=>setup.seats.includes(id)&&!this.setup[id]).concat(bots.map(b=>b.id));
    }
    begin(match,setup){
      this.stop();
      if(setup.bots&&setup.bots.length){
        match.pub.bots=setup.bots.map(bot=>Object.assign({},bot));
        match.pub.bots.forEach(bot=>{this.active[bot.id]={profile:bot,memory:{}};});
      }
      this.clearSetup();
    }
    current(time){
      var l=this.lobby,m=l.match;
      if(l.role!=='host'||!m||m.pub.phase!=='play')return null;
      var p=m.pub,adapter=adapters[p.kind],policy=strategies[p.kind];
      if(!adapter||!policy)return null;
      var turn=adapter.turn(m,this.active,this.cursor);
      if(!turn||!this.active[turn.id]||(turn.deadline&&turn.deadline<=time))return null;
      return {m:m,turn:turn,adapter:adapter,policy:policy,key:l.generation+'|'+p.id+'|'+turn.id+'|'+turn.key};
    }
    arm(current,time){
      var turn=current.turn,wait=550+Math.floor(this.random()*330);
      if(turn.deadline)wait=Math.max(0,Math.min(wait,turn.deadline-time-500));
      this.pending={key:current.key,at:time+wait};
    }
    tick(time){
      if(!Object.keys(this.active).length)return;
      var task=this.current(time);
      if(!task){this.pending=null;return;}
      if(!this.pending||this.pending.key!==task.key)this.arm(task,time);
      if(time<this.pending.at)return;
      this.pending=null;
      var l=this.lobby,turn=task.turn,bot=this.active[turn.id],view=task.adapter.view(task.m,turn.id);
      if(!view||!view.actions.length)throw Error('AI 无合法动作');
      var context=isolate({publicState:view.public,privateState:view.private,legalActions:view.actions,
        difficulty:bot.profile.difficulty,persona:bot.profile.persona,memory:bot.memory});
      var action;
      try{
        action=task.policy(Object.freeze(Object.assign({},context,{random:this.random})));
        if(action&&typeof action.then==='function'){
          Promise.resolve(action).catch(()=>{});
          throw Error('AI 策略必须同步返回');
        }
      }
      catch(e){action=null;l.note('AI 策略异常，已用合法默认动作');}
      var chosen=view.actions.find(candidate=>same(action,candidate));
      if(!chosen)chosen=view.fallback||view.actions[0];
      var before=this.current(now());
      if(!before||before.key!==task.key)return;
      var legal=before.adapter.legal?
        before.adapter.legal(before.m,turn.id,chosen):
        before.adapter.view(before.m,turn.id).actions.some(candidate=>same(chosen,candidate));
      if(!legal)throw Error('AI 行动已失效');
      var ok=l.action(turn.id,chosen);
      if(ok===false)return;
      this.cursor=turn.index+1;
      bot.memory=Object.assign({},bot.memory,{last:chosen.kind});
      if(task.adapter.observe)bot.memory=task.adapter.observe(view.public,bot.memory);
      var next=this.current(time);
      if(next)this.arm(next,time);
    }
  }
  function supports(kind){return !!(adapters[kind]&&strategies[kind]);}
  return {Manager:Manager,strategies:strategies,adapters:adapters,personas:personas,labels:labels,supports:supports};
})();
