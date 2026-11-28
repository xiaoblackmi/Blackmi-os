/// <reference path="../blackmi-sdk.d.ts" />

BlackmiSDK.games.register({
  id: 'take-stones',
  name: '取石子',
  en: 'Take Stones',
  mark: '● ● ●',
  minPlayers: 2,
  maxPlayers: 2,
  createMatch: function(match) {
    var remaining = 15;
    var turn = 0;
    var move = 0;

    return {
      act: function(playerId, action) {
        if (playerId !== match.players[turn] || action.move !== move) {
          throw Error('轮次已变化');
        }
        var count = action.count;
        if (action.kind !== 'take' || typeof count !== 'number' || !Number.isInteger(count) ||
            count < 1 || count > 3 || count > remaining) {
          throw Error('每次取 1–3 颗石子');
        }
        remaining -= count;
        move += 1;
        if (remaining === 0) {
          match.finish(playerId);
        } else {
          turn = 1 - turn;
        }
      },
      publicFor: function() {
        return { remaining: remaining, turn: match.players[turn], move: move };
      }
    };
  },
  mount: function(ctx, play, game) {
    var panel = document.createElement('div');
    panel.className = 'appbody';
    var label = document.createElement('p');
    label.setAttribute('aria-live', 'polite');
    var controls = document.createElement('div');
    controls.className = 'gactions';
    panel.appendChild(label);
    panel.appendChild(controls);
    play.appendChild(panel);
    /** @type {BlackmiGameState<{ remaining: number, turn: string, move: number }> | null} */
    var state = null;

    var buttons = [1, 2, 3].map(function(count) {
      var button = document.createElement('button');
      button.className = 'gbtn gprimary';
      button.type = 'button';
      button.textContent = '取 ' + count + ' 颗';
      controls.appendChild(button);
      ctx.listen(button, 'click', function() {
        if (state) game.submit(state.id, { kind: 'take', count: count, move: state.data.move });
      });
      return button;
    });

    return {
      render: function(next) {
        state = next;
        var status = game.status();
        var data = state.data;
        label.textContent = state.phase === 'aborted' ? '对局已中止' :
          state.winner ? game.playerName(state.winner) + ' 获胜' :
          '剩余 ' + data.remaining + ' 颗 · ' + game.playerName(data.turn) + ' 的回合';
        buttons.forEach(function(button, index) {
          button.disabled = !status.canAct || status.playerId !== data.turn || data.remaining <= index;
        });
      },
      reset: function() { state = null; }
    };
  }
});
