var BlackmiThreeKingdoms = (function() {
  'use strict';
  var definitions = {
    thrust: ['进锋', '基本', 22, '攻击一名范围内的对手，对方可用拒阵。', '锋'],
    feint: ['佯攻', '基本', 8, '距离 1 的攻击。目标可用拒阵或交出 1 军势。', '虚'],
    guard: ['拒阵', '基本', 16, '抵消一次锋、火阵或合檄。', '盾'],
    remedy: ['济伤', '基本', 10, '出牌时自疗 1 点。救援时为濒死者恢复 1 点。', '济'],
    muster: ['整军', '锦囊', 5, '摸两张牌。', '军'],
    duel: ['论阵', '锦囊', 5, '目标先出锋牌，双方轮流应锋，先放弃者受伤。', '阵'],
    shatter: ['破械', '锦囊', 6, '弃置目标首件装备，其次弃延时令，再其次弃随机手牌。', '破'],
    forage: ['截粮', '锦囊', 5, '随机取得距离 1 的对手一张手牌。', '粮'],
    flame: ['万炬', '锦囊', 4, '其他存活者依次用拒阵，否则各受 1 点伤害。', '火'],
    rampart: ['协防', '锦囊', 4, '为一名存活者设护垒，抵消下一次可抵消的伤害。', '垒'],
    edict: ['沉锋令', '延时', 4, '判赤色时禁止本回合主动使用进锋、佯攻。', '令'],
    levy: ['迟援帖', '延时', 4, '判墨色时少摸一张并禁止本回合发军令。', '帖'],
    blade: ['霜刃', '武器', 3, '攻击范围 2。主动进锋或佯攻被挡时获得 1 军势。', '刃'],
    pike: ['长槊', '武器', 3, '攻击范围 3。进锋和佯攻伤害穿过护垒。', '槊'],
    armor: ['藤甲', '防具', 4, '每全局回合一次，花 1 军势替代拒阵。', '甲'],
    charge: ['青骢', '进攻马', 3, '你到其他人的距离减 1。', '骢'],
    shelter: ['乌云', '防御马', 2, '其他人到你的距离加 1。', '云']
  };
  var suits = ['朱', '玄', '霞', '霜'];
  var deck = [];
  var cards = {};
  Object.keys(definitions).forEach(function(key) {
    var row = definitions[key];
    cards[key] = Object.freeze({name:row[0], type:row[1], count:row[2], detail:row[3], mark:row[4]});
    for (var i = 0; i < row[2]; i++) {
      var serial = deck.length;
      var suit = suits[serial % suits.length];
      deck.push(Object.freeze({id:serial, key:key, suit:suit, rank:1 + Math.floor(serial / 4) % 13,
        red:suit === '朱' || suit === '霞'}));
    }
  });
  return {cards:Object.freeze(cards), deck:Object.freeze(deck)};
})();
