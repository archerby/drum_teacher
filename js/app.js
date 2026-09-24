/* Маршрутизация по разделам (#/раздел/параметры), горячие клавиши, офлайн-режим. */
(() => {
  let currentName = null;

  function route() {
    const parts = (location.hash || '#/start').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    let name = parts[0] || 'start';
    if (!Pages[name]) name = 'start';
    const params = parts.slice(1);

    if (currentName && currentName !== name) {
      const prev = Pages[currentName];
      if (prev.hide) prev.hide();
      window.scrollTo(0, 0);
    }
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${name}`));
    document.querySelectorAll('[data-tab]').forEach((a) => {
      const on = a.dataset.tab === name;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    currentName = name;
    Pages[name].show(params);
  }

  // Кнопки-ссылки внутри уроков
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) location.hash = b.dataset.go;
  });

  // Пробел — старт/стоп в текущем разделе
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    const page = Pages[currentName];
    if (page && page.toggle) {
      e.preventDefault();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      page.toggle();
    }
  });

  // Общая громкость
  const vol = document.getElementById('master-volume');
  vol.value = Math.round(Store.get('volume', 0.8) * 100);
  Sound.setVolume(vol.value / 100);
  vol.addEventListener('input', () => {
    Sound.setVolume(vol.value / 100);
    Store.set('volume', vol.value / 100);
  });

  window.addEventListener('hashchange', route);
  route();

  // Офлайн-режим (только при открытии через http/https)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
