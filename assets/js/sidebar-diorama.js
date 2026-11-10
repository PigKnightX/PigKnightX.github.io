(() => {
  'use strict';

  const widget = document.querySelector('.sidebar-diorama');
  if (!widget || !window.IntersectionObserver) return;

  const stage = widget.querySelector('.sidebar-diorama-stage');
  let visible = false;
  let frame;
  let loading = false;

  function sync() {
    frame?.contentWindow?.postMessage({
      type: 'quidditch-visibility',
      active: visible && !document.hidden
    }, window.location.origin);
  }

  function load() {
    loading = false;
    if (!visible || document.hidden || frame) return;
    frame = document.createElement('iframe');
    frame.title = '霍格沃茨魁地奇迷你场景';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.src = widget.dataset.src;
    stage.append(frame);
  }

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
    if (visible && !frame && !loading) {
      loading = true;
      if (window.requestIdleCallback) window.requestIdleCallback(load, { timeout: 1500 });
      else setTimeout(load, 0);
    }
    sync();
  }, { threshold: [0, 0.25] }).observe(widget);

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'quidditch-ready') {
      widget.dataset.ready = '';
      sync();
    } else if (event.data?.type === 'quidditch-error') {
      delete widget.dataset.ready;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible && !frame) load();
    sync();
  });
  sync();
})();
