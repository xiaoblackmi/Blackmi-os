const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {release}=require('../build.cjs');

const puppeteer=require(process.env.THREE_KINGDOMS_PUPPETEER || 'puppeteer-core');
const chromium=process.env.THREE_KINGDOMS_CHROMIUM;
const app='.window[data-app="three-kingdoms"]';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'blackmi-rc2-ui-'));

function fixture(key) {
  const host=tkTestLobby, engine=host.match.rules, game=BlackmiThreeKingdoms;
  engine.seats.forEach((seat,i)=>{
    seat.hp=seat.max;
    seat.alive=true;
    seat.hand=[];
    seat.delay=[];
    seat.ward=false;
    seat.power=0;
    seat.missed=0;
    seat.used={};
    Object.keys(seat.gear).forEach(slot=>{seat.gear[slot]=null;});
    seat.hero=game.heroes[i].id;
  });
  engine.pile=game.deck.map(card=>card.id);
  engine.discard=[];
  engine.jobs=[];
  engine.active=0;
  engine.phase='play';
  engine.attacks=0;
  engine.actions=0;
  engine.march=false;
  engine.commandUsed=false;
  engine.drawCount=2;
  engine.noAttack=false;
  engine.noCommand=false;
  engine.discardLimit=1;
  engine.playRemaining=engine.profile.play;
  const draw=key=>{
    const i=engine.pile.findIndex(id=>game.deck[id].key===key);
    if (i===-1) throw Error('Fixture exhausted: '+key);
    return engine.pile.splice(i,1)[0];
  };
  const self=engine.seats[0], other=engine.seats[1];
  const give=card=>{
    const id=draw(card);
    self.hand.push(id);
    return id;
  };
  let selected=null;
  switch(key){
    case 'play':
      selected=give('thrust');
      engine.open('play',0);
      break;
    case 'discard':
      give('armor'); give('blade'); give('guard');
      engine.phase='discard';
      engine.open('discard',0);
      break;
    case 'guard-card':
      self.hero='zhao';
      selected=give('thrust');
      engine.open('guard',0,{source:1,mode:'thrust',pierce:true});
      break;
    case 'guard-armor':
      self.gear.armor=draw('armor');
      self.power=1;
      engine.open('guard',0,{source:1,mode:'flame'});
      break;
    case 'guard-yield':
      self.power=1;
      engine.open('guard',0,{source:1,mode:'feint'});
      break;
    case 'duel':
      selected=give('thrust');
      engine.open('duel',0,{source:1});
      break;
    case 'rescue':
      self.hero='hua';
      self.power=1;
      engine.seats[2].hp=0;
      selected=give('guard');
      engine.open('rescue',0,{source:1,target:2,remaining:[1]});
      break;
    case 'stars':
      self.hero='zhuge';
      selected=draw('armor');
      engine.phase='prepare';
      engine.jobs.push({type:'judgment'});
      engine.open('stars',0,{look:[selected,draw('blade')]});
      break;
    case 'rewrite':
      self.hero='sima';
      selected=give('thrust');
      engine.phase='judge';
      engine.jobs.push({type:'judgment'});
      engine.open('rewrite',0,{order:draw('edict'),target:0});
      break;
    case 'harry':
      self.hero='liao';
      other.hand.push(draw('guard'));
      engine.phase='draw';
      engine.open('harry',0);
      break;
    case 'scheme':
      selected=give('blade');
      engine.open('scheme',0,{source:1});
      break;
    case 'command':
      self.power=3;
      other.hp=2;
      engine.open('play',0);
      break;
    case 'skill':
      self.hero='liu';
      selected=give('guard');
      engine.open('play',0);
      break;
    case 'resume':
      self.missed=2;
      engine.open('play',0);
      break;
    case 'extreme':
      self.hand=engine.pile.splice(0);
      engine.open('play',0);
      break;
    default: throw Error('Unknown fixture '+key);
  }
  host.sync();
  return {selected,seq:engine.window.seq};
}

async function check(page,width,height,fixtureUrl) {
  const errors=[];
  const onError=e=>errors.push(e.message);
  page.on('pageerror',onError);
  const wait=(fn,...args)=>page.waitForFunction(fn,{},...args);
  const tap=selector=>page.tap(app+' '+selector);
  const info=selector=>page.$eval(app+' '+selector,node=>node.textContent);
  const apply=async key=>{
    const test=await page.evaluate(fixture,key);
    await wait((selector,seq)=>document.querySelector(selector+' .tk') &&
      tkTestLobby.state.data.pending.seq===seq,app,test.seq);
    // The SDK coalesces the DOM update to the next foreground frame.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    return test.selected;
  };
  const respond=async selector=>{
    await tap(selector);
    await page.waitForSelector(app+' [data-confirm]:not([disabled])');
    await tap('[data-confirm]');
  };
  const assertWindow=type=>wait(type=>tkTestLobby.state.data.pending.type===type,type);
  const matches=(selector,pattern)=>wait((selector,source,flags)=>{
    const node=document.querySelector(selector);
    return node && new RegExp(source,flags).test(node.textContent);
  },app+' '+selector,pattern.source,pattern.flags);
  const checkEffect=pattern=>matches('[data-effect]',pattern);

  try {
    await page.setViewport({width,height,deviceScaleFactor:2,hasTouch:true,isLandscape:true});
    await page.goto(pathToFileURL(release).href);
    assert.equal(await page.title(),'Blackmi OS · 3.3 Three Kingdoms RC2');
    assert.deepEqual(await page.evaluate(()=>[innerWidth,innerHeight,devicePixelRatio,BlackmiSDK.games.list().length]),[width,height,2,15]);
    await page.evaluate(()=>BlackmiSDK.apps.launch('game-center'));
    await page.tap('[data-g="open:three-kingdoms"]');
    await page.waitForSelector(app+' [data-gate]',{visible:true});

    await page.goto(fixtureUrl);
    await page.evaluate(()=>{
      const host=tkTestLobby;
      host.create('房主');
      for(let i=1;i<8;i++)host.players.push({id:'sim-'+i,name:'席位 '+(i+1),ready:false});
      host.prepare('three-kingdoms');
      host.players.forEach((seat,i)=>{host.assign(seat.id,i,host.me);host.setReady(seat.id,true,i);});
      host.start('three-kingdoms');
      BlackmiSDK.apps.launch('three-kingdoms');
    });
    await page.waitForSelector(app+' [data-mode="fast"]',{visible:true});
    await page.waitForSelector(app+' [data-mode="standard"]',{visible:true});
    const mode=width===834?'fast':'standard';
    await respond('[data-mode="'+mode+'"]');
    await wait(mode=>tkTestLobby.state.data.mode===mode,mode);

    let card=await apply('play');
    const board=await page.$eval(app+' .tk',root=>{
      const r=root.getBoundingClientRect(), bottom=root.querySelector('.tk-bottom').getBoundingClientRect();
      const center=root.querySelector('.tk-center').getBoundingClientRect();
      return {size:[r.width,r.height],overlap:bottom.bottom>r.bottom+1 || root.scrollWidth>root.clientWidth+1 ||
        Array.from(root.querySelectorAll('[data-rivals] .tk-seat')).some(node=>node.getBoundingClientRect().bottom>center.top),
        textClipped:Array.from(root.querySelectorAll('[data-clock],[data-hint],[data-effect],[data-detail]')).some(node=>{
          const b=node.getBoundingClientRect();
          return b.top<center.top||b.bottom>center.bottom||b.height===0;
        })};
    });
    assert.equal(board.overlap,false,JSON.stringify(board));
    assert.equal(board.textClipped,false,JSON.stringify(board));
    assert.equal(await page.$$eval(app+' .tk-seat',nodes=>nodes.length),7);
    await tap('[data-seat="1"]');
    await matches('[data-info-body]',/射程.+你到对方 1.+对方到你 1/s);
    await tap('[data-close-info]');
    await tap('[data-card="'+card+'"]');
    await page.waitForSelector(app+' [data-seat="1"].tk-legal',{visible:true});
    await tap('[data-cancel]');
    await wait(selector=>document.querySelector(selector+' [data-confirm]').disabled,app);
    await tap('[data-card="'+card+'"]');
    await tap('[data-seat="1"]');
    await page.waitForSelector(app+' [data-confirm]:not([disabled])');
    await tap('[data-confirm]');
    await assertWindow('guard');
    await checkEffect(/1席.+→ 2席.+进锋/);

    await apply('discard');
    assert.equal(await info('[data-pass]'),'自动弃');
    await tap('[data-pass]');
    await wait(()=>tkTestLobby.match.rules.seats[0].hand.length===1);

    card=await apply('guard-card');
    await checkEffect(/穿护垒/);
    assert.match(await info('[data-detail]'),/可发动 反身/);
    await respond('[data-card="'+card+'"]');
    await assertWindow('play');
    await apply('guard-armor');
    await tap('[data-hero]');
    await matches('[data-info-body]',/藤甲.+替代拒阵/);
    await tap('[data-close-info]');
    await respond('[data-mode="armor"]');
    await wait(()=>tkTestLobby.match.rules.seats[0].power===0);
    await apply('guard-yield');
    await respond('[data-mode="yield"]');
    await assertWindow('play');

    card=await apply('duel');
    await checkEffect(/论阵.*放弃受 1 伤害/);
    await respond('[data-card="'+card+'"]');
    await wait(()=>tkTestLobby.state.data.pending.type==='duel' && tkTestLobby.state.data.pending.seat===1);

    card=await apply('rescue');
    await checkEffect(/伤害来源 2席.*3席.*濒死.*1席.*应救/);
    assert.match(await info('[data-detail]'),/可发动 行医/);
    await respond('[data-card="'+card+'"]');
    await wait(()=>tkTestLobby.match.rules.seats[2].hp===1);

    card=await apply('stars');
    await checkEffect(/兆牌仅本人可见/);
    await respond('[data-card="'+card+'"]');
    await assertWindow('play');
    card=await apply('rewrite');
    await checkEffect(/改兆.*沉锋令/);
    await respond('[data-card="'+card+'"]');
    await wait(()=>tkTestLobby.match.rules.noAttack===true);
    await apply('harry');
    await checkEffect(/袭仓/);
    await respond('[data-seat="1"]');
    await wait(()=>tkTestLobby.match.rules.seats[1].hand.length===0);
    card=await apply('scheme');
    await checkEffect(/离席计/);
    await tap('[data-pass]');
    await wait(card=>tkTestLobby.match.rules.seats[1].hand.includes(card),card);

    await apply('command');
    await tap('[data-mode="ward"]');
    await respond('[data-seat="1"]');
    await wait(()=>tkTestLobby.match.rules.seats[1].ward===true);
    await apply('command');
    await respond('[data-mode="march"]');
    await wait(()=>tkTestLobby.state.data.seats[0].range===3);
    card=await apply('skill');
    await tap('[data-mode="skill"]');
    await tap('[data-card="'+card+'"]');
    await respond('[data-seat="1"]');
    await wait(card=>tkTestLobby.match.rules.seats[1].hand.includes(card),card);
    await apply('resume');
    await tap('[data-return]');
    await wait(()=>tkTestLobby.state.data.pending.auto===false &&
      tkTestLobby.match.rules.seats[0].missed===0);

    await apply('extreme');
    assert.equal(await page.$$eval(app+' [data-hand] [data-card]',nodes=>nodes.length),12);
    const insertions=await page.evaluate(async ()=>{
      const root=document.querySelector('.tk'), hand=root.querySelector('[data-hand]');
      let count=0;
      const observer=new MutationObserver(records=>records.forEach(record=>Array.from(record.addedNodes).forEach(node=>{
        if(node.nodeType===1)count+=1+node.querySelectorAll('*').length;
      })));
      observer.observe(hand,{childList:true,subtree:true});
      root.querySelector('[data-page-next]').click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      observer.disconnect();
      return count;
    });
    assert(insertions>0 && insertions<=100,insertions);
    assert.equal(await page.$$eval(app+' [data-hand] [data-card]',nodes=>nodes.length),12);
    const reused=await page.evaluate(async ()=>{
      const root=document.querySelector('.tk'), seat=root.querySelector('.tk-seat'), card=root.querySelector('[data-card]');
      tkTestLobby.sync();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return seat===root.querySelector('.tk-seat') && card===root.querySelector('[data-card]');
    });
    assert(reused);
    await page.evaluate(()=>{tkTestLobby.me='observer';tkTestLobby.sync();});
    await page.waitForSelector(app+' .tk-status-note',{visible:true});
    assert.equal(await page.$$eval(app+' [data-card]',nodes=>nodes.length),0);
    assert.deepEqual(errors,[]);
    const windows=['mode','play','discard','guard','duel','rescue','stars','rewrite','harry','scheme'];
    console.log(JSON.stringify({width,height,mode,board,insertions,reused,windows,
      resume:true,maximumHand:108,spectatorNoHand:true,errors:errors.length}));
  } finally {
    page.removeListener('pageerror',onError);
  }
}

async function run() {
  if (!chromium) throw Error('Set THREE_KINGDOMS_CHROMIUM to a Chromium 80 executable');
  const source=fs.readFileSync(release,'utf8'), marker='root.BlackmiSDK=Object.freeze';
  assert.equal(source.split(marker).length,2);
  const instrumented=path.join(scratch,'fixture.html');
  fs.writeFileSync(instrumented,source.replace(marker,'root.tkTestLobby=service;\n'+marker));
  const browser=await puppeteer.launch({executablePath:chromium,
    args:['--no-sandbox','--disable-gpu','--single-process','--no-zygote'],timeout:10000});
  try {
    const version=await browser.version();
    assert.match(version,/Chrome\/80\./);
    console.log(version);
    const page=await browser.newPage();
    page.setDefaultTimeout(6500);
    const url=pathToFileURL(instrumented).href;
    for (const [width,height] of [[834,360],[960,600]]) await check(page,width,height,url);
  } finally {
    await browser.close();
  }
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(scratch,{recursive:true,force:true}));
