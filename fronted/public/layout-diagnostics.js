(function () {
  'use strict';
  if (!/(?:[?&])layout-debug=1(?:&|$)/.test(window.location.search)) return;
  var failures = [];
  window.addEventListener('error', function (event) {
    if (event.message) failures.push(String(event.message).slice(0, 300));
  });
  function inspect(selector) {
    var element = document.querySelector(selector);
    if (!element) return null;
    var style = window.getComputedStyle(element);
    var rect = element.getBoundingClientRect();
    var centerX = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    var centerY = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    var top = document.elementFromPoint(centerX, centerY);
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: style.display, direction: style.flexDirection,
      columns: style.gridTemplateColumns, fontSize: style.fontSize,
      visibility: style.visibility, pointerEvents: style.pointerEvents,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      inert: !!element.closest('[inert]'),
      centerHit: top ? top.tagName + '.' + String(top.getAttribute('class') || '') : null,
      variables: {
        columns: style.getPropertyValue('--card-columns').trim(),
        width: style.getPropertyValue('--card-width').trim(),
        minHeight: style.getPropertyValue('--card-min-height').trim(),
        viewportWidth: style.getPropertyValue('--viewport-width').trim(),
        viewportHeight: style.getPropertyValue('--viewport-height').trim()
      }
    };
  }
  function report() {
    var root = document.documentElement;
    var ruler = document.createElement('div');
    ruler.style.cssText = 'position:fixed;left:0;top:0;width:100rem;height:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(ruler);
    var measuredRem = ruler.getBoundingClientRect().width / 100;
    ruler.remove();
    var boxes = [];
    var cards = document.querySelectorAll('.evaluation-slot');
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      boxes.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    var supports = function (property, value) {
      return !!(window.CSS && CSS.supports && CSS.supports(property, value));
    };
    return {
      diagnosticVersion: 2, browser: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        visualWidth: window.visualViewport ? visualViewport.width : null,
        visualHeight: window.visualViewport ? visualViewport.height : null },
      screen: { width: screen.width, height: screen.height },
      root: { fontSize: getComputedStyle(root).fontSize, pixelUnit: getComputedStyle(root).getPropertyValue('--pixel').trim(), measuredRem: measuredRem, layout: root.getAttribute('data-layout'),
        ratio: root.getAttribute('data-pixel-ratio'), sidebar: root.getAttribute('data-sidebar') },
      support: { grid: supports('display', 'grid'), gridVariables: supports('grid-template-columns', 'repeat(var(--card-columns, 3), var(--card-width, 240rem))'),
        flexGap: supports('gap', '1px'), hasSelector: !!(window.CSS && CSS.supports && CSS.supports('selector(:has(*))')),
        resizeObserver: typeof ResizeObserver !== 'undefined', dialog: typeof HTMLDialogElement !== 'undefined' && !!HTMLDialogElement.prototype.showModal },
      welcome: inspect('.welcome'), grid: inspect('.evaluation-panels'), cards: boxes,
      firstCard: inspect('.evaluation-panel'), hitArea: inspect('.evaluation-hit-area'),
      settings: inspect('[aria-label="工作台设置"]'), modal: inspect('dialog'),
      assets: Array.prototype.map.call(document.querySelectorAll('script[src],link[rel="stylesheet"]'), function (node) {
        return node.getAttribute('src') || node.getAttribute('href');
      }), errors: failures.slice(-8)
    };
  }
  function mount() {
    var box = document.createElement('aside');
    box.id = 'pixel-layout-diagnostics';
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#fff;color:#111;border:2px solid #68438f;padding:10px;max-width:calc(100vw - 24px);font:14px/1.5 monospace;';
    var button = document.createElement('button');
    button.textContent = '读取并复制布局诊断';
    button.style.cssText = 'font:14px/1.5 sans-serif;padding:6px 10px;background:#68438f;color:white;border:0;cursor:pointer;';
    var close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText = 'font:14px/1.5 sans-serif;margin-left:10px;padding:6px;cursor:pointer;';
    var message = document.createElement('p');
    message.textContent = '仅读取浏览器和布局信息，不读取对话、密码或密钥，不上传。';
    message.style.cssText = 'font:12px/1.5 sans-serif;margin:6px 0 0;';
    var output = document.createElement('textarea');
    output.readOnly = true;
    output.setAttribute('aria-label', '布局诊断结果');
    output.style.cssText = 'display:none;width:540px;max-width:100%;height:220px;margin-top:8px;font:12px/1.5 monospace;color:#111;background:#fff;';
    button.onclick = function () {
      // Keep the diagnostics panel out of the hit-testing measurements.
      box.style.visibility = 'hidden';
      var result;
      try { result = report(); } finally { box.style.visibility = 'visible'; }
      output.value = JSON.stringify(result, null, 2);
      output.style.display = 'block'; output.focus(); output.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (_) {}
      message.textContent = copied ? '已复制，请把结果粘贴给我。' : '结果已选中，请按 Ctrl+C 复制后粘贴给我。';
    };
    close.onclick = function () { box.remove(); };
    box.appendChild(button); box.appendChild(close); box.appendChild(message); box.appendChild(output);
    document.body.appendChild(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
