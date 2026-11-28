const fs=require('node:fs');
const path=require('node:path');
const {Script}=require('node:vm');

const base=path.join(__dirname,'../../client/Blackmi_OS_V3.3_ThreeKingdoms_RC2.html');
const release=path.join(__dirname,'../../client/Blackmi_OS_V3.4_AI_Arena.html');
const modules=['manager.js','adapters.js','gomoku.js','uno.js','three-kingdoms.js','seats.js'];
function build(output=release){
  let html=fs.readFileSync(base,'utf8');
  function replace(before,after){
    if(html.split(before).length!==2)throw Error('Expected unique RC2 anchor: '+before.slice(0,80));
    html=html.replace(before,()=>after);
  }
  function patch(before,after){
    if(!html.includes(before))throw Error('Missing RC2 anchor: '+before.slice(0,80));
    html=html.replace(before,()=>after);
  }

  replace('name="blackmi-version" content="3.3"','name="blackmi-version" content="3.4"');
  replace("APP_EDITION='Three Kingdoms RC2'","APP_EDITION='AI Arena'");
  replace('var service=new Lobby(),',modules.map(name=>fs.readFileSync(path.join(__dirname,name),'utf8')).join('\n')+'\nvar service=new Lobby(),');
  replace('this.generation=0;this.setup=null}', 'this.generation=0;this.setup=null;this.botManager=new ArenaBots.Manager(this)}');
  replace(" failMatch(message){\n  this.match", " failMatch(message){\n  this.botManager.clear();\n  this.match");
  replace("check(Object.prototype.hasOwnProperty.call(titles,kind),'游戏无效');this.setup=", "check(Object.prototype.hasOwnProperty.call(titles,kind),'游戏无效');this.botManager.clear();this.setup=");
  replace("只有房主可以取消准备');this.setup=null", "只有房主可以取消准备');this.botManager.clearSetup();this.setup=null");
  replace("check(this.players.some(x=>x.id===id),'成员不在线');", "check(this.players.some(x=>x.id===id)||actor===this.me&&this.botManager.setup[id],'座位成员无效');");
  replace("p.ready=p.ready.filter(x=>x!==id&&x!==other);this.error", "p.ready=p.ready.filter(x=>x!==id&&x!==other);this.botManager.refresh();this.error");
  replace("p.seats=p.seats.map((_,i)=>ids[i]||null);p.ready=[];", "p.seats=p.seats.map(id=>random&&this.botManager.setup[id]?id:ids.shift()||null);p.ready=[];this.botManager.refresh();");
  replace("&&p.seats[slot]===id,'座位已变化", "&&p.seats[slot]===id&&!this.botManager.setup[id],'座位已变化");
  replace("players.every(id=>this.players.some(x=>x.id===id)&&p.ready.includes(id))", "players.every(id=>(this.players.some(x=>x.id===id)||this.botManager.setup[id])&&p.ready.includes(id))");
  replace("等待全部参赛者准备');this.match=", "等待全部参赛者准备');if(p.bots&&p.bots.length){var human=id=>this.players.some(x=>x.id===id);check(players.some(human),'至少一名真人须参赛');if(kind==='holdem'||kind==='three-kingdoms'&&!players.includes(this.me))check(p.seats[0]===players[0]&&human(players[0]),'混合局 1 号席须为真人');}this.match=");
  replace("this.match.pub.comments=[];this.setup=null;", "this.match.pub.comments=[];this.botManager.begin(this.match,p);this.setup=null;");
  replace("只有房主能结束');this.match=null", "只有房主能结束');this.botManager.clear();this.match=null");
  replace("this.match.pub.phase='aborted';this.match.pub.rev++", "this.botManager.stop();this.match.pub.phase='aborted';this.match.pub.rev++");
  replace("leave(){this.generation++;this.resetting", "leave(){this.generation++;this.botManager.clear();this.resetting");
  replace("this.err('操作确认超时')}\n  }\n }", "this.err('操作确认超时')}\n  }\n  if(this.match&&['end','aborted'].includes(this.match.pub.phase))this.botManager.stop();\n  try{this.botManager.tick(now())}catch(e){this.failMatch('AI 行动异常，已安全结束对局')}\n }");
  replace("function name(id){var p=service.players.find(x=>x.id===id);return p?p.name:'已离开成员'}", "function name(id){return arenaName(arenaMember(service,id))}");
  replace("请先创建或加入游戏大厅</p>'+btn('lobby','前往大厅','gprimary')", "请先创建或加入游戏大厅</p>'+(ArenaBots.supports(kind)?btn('bot-solo','单机人机','gprimary'):'')+btn('lobby','前往大厅')");
  replace("+' 已准备</strong></div><div class=\"seat-grid\"", "+' 已准备</strong></div>'+arenaSeatTools(kind,p,host)+'<div class=\"seat-grid\"");
  replace("var who=service.players.find(x=>x.id===id),isMine", "var who=arenaMember(service,id,p),isMine");
  replace("+service.players.map(x=>'<option value=", "+service.players.concat(p.bots||[]).map(x=>'<option value=");
  replace("+'>'+esc(x.name)+(x.id===service.me?'（我）':'')+'</option>'", "+'>'+esc(arenaName(x))+(x.id===service.me?'（我）':'')+'</option>'");
  replace("(who?esc(who.name)+(isMine?", "(who?esc(arenaName(who))+(isMine?");
  replace("btn('seat:'+i,'入座','gprimary'):''))+'</div>'", "btn('seat:'+i,'入座','gprimary'):''))+arenaBotTools(kind,i,who,host)+'</div>'");
  replace("(service.players.length-count)+' 人", "service.players.filter(x=>!p.seats.includes(x.id)).length+' 人");
  replace("else if(a==='start')asyncRun(()=>service.start(kind));", "else if(a==='start')asyncRun(()=>service.start(kind));else if(a==='bot-solo')asyncRun(()=>service.soloBots(kind));else if(a.indexOf('bot-add:')===0||a.indexOf('bot-remove:')===0){var parts=a.split(':');asyncRun(()=>service.configureBot(+parts[1],parts[0].slice(4)));}");
  replace("ctx.listen(gate,'change',e=>{if(e.target.dataset.seat", "ctx.listen(gate,'change',e=>{var d=e.target.dataset,v=e.target.value;if(d.botTotal!==undefined){if(v)asyncRun(()=>service.fillBots(+v));return}if(d.botLevel!==undefined||d.botPersona!==undefined){var level=d.botLevel!==undefined;asyncRun(()=>service.configureBot(+(level?d.botLevel:d.botPersona),level?'difficulty':'persona',v));return}if(e.target.dataset.seat");
  replace("btn('comments','评论 0')+btn('lobby','游戏大厅')", "btn('comments','评论 0')+'<span data-arena-control></span>'+btn('lobby','游戏大厅')");
  replace("var cb=r.querySelector('[data-g=comments]');", "var controls=active&&service.role==='host'&&s.bots&&s.bots.length?(['end','aborted'].includes(s.phase)?btn('again','再开'):btn('end','结束')):'';uiHTML(r.querySelector('[data-arena-control]'),controls);var cb=r.querySelector('[data-g=comments]');");
  const css='<style>.arena-setup,.arena-seat-tools{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin:3px 0}.arena-setup select,.arena-seat-tools select{width:auto;min-width:0;max-width:100%;margin:0 4px 0 0}.arena-seat-tools .gbtn{padding:2px 5px}.arena-seat-tools select{flex:1 1 48px}.arena-setup b{margin-right:7px}</style>';
  patch('</body></html>',css+'</body></html>');
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(match[1]);
  fs.writeFileSync(output,html,{flag:'wx'});
  return output;
}
if(require.main===module){
  try{console.log(build(process.argv[2]));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={build,base,release,modules};
