/// <reference path="../blackmi-sdk.d.ts" />

BlackmiSDK.apps.register({
  id: 'demo-counter',
  name: '计数器',
  desktop: true,
  mount: function(ctx) {
    var panel = document.createElement('div');
    panel.className = 'appbody';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    var count = ctx.storage.get('count', 0);
    var render = ctx.onRender(function() {
      button.textContent = '计数 ' + count;
    });

    panel.appendChild(button);
    ctx.root.appendChild(panel);
    ctx.listen(button, 'click', function() {
      count += 1;
      ctx.storage.set('count', count);
      render.invalidate();
    });
    render.invalidate();
  }
});
