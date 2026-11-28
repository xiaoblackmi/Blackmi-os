const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {release}=require('./build.cjs');

async function check(browser,width,height,url){
  const page=await browser.newPage(),errors=[],remote=[];
  const win=kind=>'.window[data-app="'+kind+'"]';
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
  await page.evaluateOnNewDocument(()=>{
    window.arenaPeerAttempts=0;
    window.RTCPeerConnection=function(){window.arenaPeerAttempts++;throw Error('Unexpected network connection in offline fixture');};
  });
  await page.setViewport({width,height,deviceScaleFactor:2,hasTouch:true,isLandscape:true});
  page.setDefaultTimeout(9000);
  const launch=kind=>page.evaluate(kind=>BlackmiSDK.apps.launch(kind),kind);
  const tap=async selector=>{await page.waitForSelector(selector,{visible:true});await page.tap(selector);};
  const wait=(fn,...args)=>page.waitForFunction(fn,{},...args);
  try{
    await page.goto(pathToFileURL(release).href);
    assert.equal(await page.title(),'Blackmi OS · 3.4 AI Arena RC2');
    assert.deepEqual(await page.evaluate(()=>[innerWidth,innerHeight,BlackmiSDK.games.list().length]),[width,height,15]);
    await launch('game-center');
    await tap('[data-g="open:gomoku"]');
    await tap(win('gomoku')+' [data-g="bot-solo"]');
    await page.waitForSelector(win('gomoku')+' canvas.gboard',{visible:true});

    await page.goto(url);
    await launch('gomoku');
    await tap(win('gomoku')+' [data-g="bot-solo"]');
    await page.waitForSelector(win('gomoku')+' canvas.gboard',{visible:true});
    const board=await page.$eval(win('gomoku')+' canvas.gboard',node=>{
      const r=node.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};
    });
    assert(board.w>=120&&board.h>=120&&board.y>0&&board.y<height);
    await page.touchscreen.tap(board.x,board.y);
    await wait(()=>arenaFixture.state.moves.length>=1);
    await tap(win('gomoku')+' [data-win="min"]');
    await wait(()=>arenaFixture.state.moves.length===2);
    assert.equal(await page.$eval(win('gomoku'),el=>el.classList.contains('min')),true);
    assert.deepEqual(await page.evaluate(()=>[arenaFixture.players.length,arenaFixture.links.length,arenaFixture.state.bots.length,arenaPeerAttempts]),
      [1,0,1,0]);
    await page.evaluate(()=>{arenaFixture.leave();arenaFixture.create('房主');arenaFixture.prepare('kingdoms');arenaFixture.seat(0);arenaFixture.ready(true);});
    await launch('kingdoms');
    const table=win('kingdoms');
    await tap(table+' [data-g="bot-add:1"]');
    await wait(()=>arenaFixture.setup.bots.length===1);
    await page.select(table+' [data-bot-level="1"]','easy');
    await wait(()=>arenaFixture.setup.bots[0].difficulty==='easy');
    await page.select(table+' [data-bot-persona="1"]','defense');
    await wait(()=>arenaFixture.setup.bots[0].persona==='defense');
    await tap(table+' [data-g="bot-remove:1"]');
    await wait(()=>!arenaFixture.setup.bots);
    await page.select(table+' [data-bot-total]','8');
    await wait(()=>arenaFixture.setup.bots.length===7);
    assert.match(await page.$eval(table+' .arena-setup b',n=>n.textContent),/1 真人.*7 AI.*8 人/);
    assert.match(await page.$eval(table+' .seat-watch b',n=>n.textContent),/0 人/);
    const layout=await page.$eval(table+' .seat-layout',n=>{
      const g=n.querySelector('.seat-grid');
      return {scroll:n.scrollWidth,client:n.clientWidth,cols:g.children.length};
    });
    assert(layout.scroll<=layout.client+2&&layout.cols===8,JSON.stringify(layout));
    await tap(table+' [data-g="start"]');
    await wait(()=>arenaFixture.state.kind==='kingdoms'&&arenaFixture.state.players.length===8);
    await wait(()=>Array.from(document.querySelectorAll('[data-krlegend] span')).filter(e=>e.textContent.includes('AI')).length===7);
    await tap(table+' [data-arena-control] [data-g="end"]');
    await tap('#blackmi-game-confirm button:last-child');
    await wait(()=>!arenaFixture.match&&!arenaFixture.botManager.pending);
    await page.evaluate(()=>arenaFixture.leave());

    for(const kind of ['uno','three-kingdoms','holdem','kingdoms']){
      await page.evaluate(()=>{if(arenaFixture.role)arenaFixture.leave();});
      await launch(kind);
      await tap(win(kind)+' [data-g="bot-solo"]');
      await wait(kind=>arenaFixture.state&&arenaFixture.state.kind===kind,kind);
      assert.equal(await page.evaluate(()=>arenaFixture.links.length),0);
      if(kind==='three-kingdoms'){
        await tap(win(kind)+' [data-mode="fast"]');
        await tap(win(kind)+' [data-confirm]:not([disabled])');
        await wait(()=>arenaFixture.state.data.mode==='fast');
      }
    }
    assert.deepEqual(errors,[]);
    assert.deepEqual(remote,[]);
    console.log(JSON.stringify({width,height,touch:true,offlineGames:5,networkRequests:remote.length,
      minimizedBotMoved:true,kingdomsSetupSeats:layout.cols,setupOverflow:layout.scroll-layout.client,errors:errors.length}));
  }finally{await page.close();}
}

async function loopback(browser,url){
  const host=await browser.newPage(),guest=await browser.newPage();
  try{
    host.setDefaultTimeout(12000);guest.setDefaultTimeout(12000);
    await Promise.all([host.goto(url),guest.goto(url)]);
    const offer=await host.evaluate(async()=>{arenaFixture.create('Host');await arenaFixture.offer();return arenaFixture.code;});
    assert(offer,await host.evaluate(()=>arenaFixture.error||arenaFixture.stage));
    const answer=await guest.evaluate(async data=>{await arenaFixture.importCode(data,'Guest');return arenaFixture.code;},offer);
    assert(answer,await guest.evaluate(()=>arenaFixture.error||arenaFixture.stage));
    await host.evaluate(data=>arenaFixture.importCode(data,'Host'),answer);
    await guest.waitForFunction(()=>arenaFixture.me);
    await host.evaluate(()=>{
      arenaFixture.prepare('uno');arenaFixture.seat(0);arenaFixture.ready(true);
    });
    await guest.waitForFunction(()=>arenaFixture.setup&&arenaFixture.setup.kind==='uno');
    await guest.evaluate(()=>arenaFixture.seat(1));
    await guest.waitForFunction(()=>arenaFixture.setup.seats[1]===arenaFixture.me);
    await guest.evaluate(()=>arenaFixture.ready(true));
    await host.waitForFunction(()=>arenaFixture.setup.ready.length===2);
    await host.evaluate(()=>{arenaFixture.fillBots(3);arenaFixture.start('uno');});
    await guest.waitForFunction(()=>arenaFixture.state&&arenaFixture.state.bots.length===1);
    for(const page of [host,guest]){
      await page.waitForFunction(()=>arenaFixture.state.players[arenaFixture.state.turn]===arenaFixture.me);
      await page.evaluate(()=>arenaFixture.act({kind:'draw'}));
      await page.waitForFunction(()=>arenaFixture.state.drawn&&!arenaFixture.awaiting);
      await page.evaluate(()=>arenaFixture.act({kind:'pass'}));
    }
    await guest.waitForFunction(()=>arenaFixture.state.rev>=5);
    assert.deepEqual(await guest.evaluate(()=>[arenaFixture.links.length,arenaFixture.players.length,arenaFixture.state.players.length,
      arenaFixture.state.bots.length,arenaFixture.private.hand.length>=8]),[1,2,3,1,true]);
    console.log(JSON.stringify({rtc:'same-machine two-page DataChannel',humans:2,bots:1,guestActions:2,botAfterGuest:true}));
  }finally{await guest.close();await host.close();}
}

async function virtualSoak(browser,url){
  const page=await browser.newPage();
  try{
    await page.setViewport({width:834,height:360,hasTouch:true,isLandscape:true});
    await page.goto(url);
    await page.evaluate(()=>{
      const l=arenaFixture;
      let rooms=0,cycles=0,botActions=0;
      let time=Date.now();
      const wallClock=Date.now;
      Date.now=()=>time;
      const action=l.action.bind(l);
      l.action=function(id,move){
        const ok=action(id,move);
        if(ok!==false&&id.indexOf('bot-')===0)botActions++;
        return ok;
      };
      function play(){
        if(!l.match||l.idle()){
          if(!l.role)l.create('Soak');
          l.prepare('uno');l.seat(0);l.ready(true);l.fillBots(8);l.start('uno');rooms++;
        }
        const s=l.state;
        if(s.players[s.turn]===l.me){
          const bots=arenaFixtureBots,v=bots.adapters.uno.view(l.match,l.me);
          l.act(bots.strategies.uno({publicState:v.public,privateState:v.private,legalActions:v.actions,difficulty:'normal',random:()=>.42}));
        }
        cycles++;
      }
      play();
      window.soakHandle=setInterval(play,1500);
      window.soakTick=setInterval(()=>{time+=500;l.tick();},500);
      window.soakStats=()=>({rooms,cycles,botActions,links:l.links.length,time,error:l.error,rev:l.state&&l.state.rev});
      window.soakRestore=()=>{Date.now=wallClock;};
    });
    const started=await page.evaluate(()=>soakStats().time);
    const session=await page.target().createCDPSession();
    const expire=new Promise(resolve=>session.on('Emulation.virtualTimeBudgetExpired',resolve));
    await session.send('Emulation.setVirtualTimePolicy',{policy:'advance',budget:1800000,maxVirtualTimeTaskStarvationCount:64});
    let timeout;
    await Promise.race([expire,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Chromium virtual soak timed out')),25000);})])
      .finally(()=>clearTimeout(timeout));
    const result=await page.evaluate(()=>{clearInterval(soakHandle);clearInterval(soakTick);soakRestore();return soakStats();});
    assert(result.time-started>=1800000&&result.cycles>=1199&&result.rooms>1&&result.botActions>500&&result.links===0,JSON.stringify(result));
    await session.detach();
    console.log(JSON.stringify({chromiumVirtualMinutes:30,hostChecks:result.cycles,matches:result.rooms,botActions:result.botActions,links:result.links}));
  }finally{await page.close();}
}

async function main(){
  const executablePath=process.env.ARENA_CHROMIUM;
  if(!executablePath)throw Error('Set ARENA_CHROMIUM to a Chromium 80 executable');
  const puppeteer=require(process.env.ARENA_PUPPETEER||'puppeteer-core');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'blackmi-arena-browser-'));
  const fixture=path.join(tmp,'fixture.html'),src=fs.readFileSync(release,'utf8'),anchor='root.BlackmiSDK=Object.freeze';
  assert.equal(src.split(anchor).length,2);
  fs.writeFileSync(fixture,src.replace(anchor,'root.arenaFixture=service;root.arenaFixtureBots=ArenaBots;\n'+anchor));
  let browser;
  try{
    browser=await puppeteer.launch({executablePath,args:['--no-sandbox','--disable-gpu','--single-process','--no-zygote'],timeout:10000});
    const version=await browser.version();
    assert.match(version,/Chrome\/80\./);
    console.log(version);
    const url=pathToFileURL(fixture).href;
    for(const [width,height] of [[834,360],[960,600]])await check(browser,width,height,url);
    if(process.argv.includes('--rtc'))await loopback(browser,url);
    if(process.argv.includes('--virtual-soak'))await virtualSoak(browser,url);
  }finally{
    if(browser)await browser.close();
    fs.rmSync(tmp,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
