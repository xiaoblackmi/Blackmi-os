(function(game) {
  'use strict';
  BlackmiSDK.games.register({
    id:'three-kingdoms',
    name:'汉末·逐鹿',
    en:'Three Kingdoms',
    color:'#354c3b',
    mark:'逐鹿',
    minPlayers:4,
    maxPlayers:8,
    createMatch:function(info) { return game.create(info); },
    mount:game.mount
  });
  Object.freeze(game);
})(BlackmiThreeKingdoms);
