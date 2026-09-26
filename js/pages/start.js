window.Pages = window.Pages || {};

Pages.start = (() => {
  const el = document.getElementById('page-start');

  function itemInfo(code) {
    const [type, ...rest] = code.split(':');
    const key = rest.join(':');
    if (type === 'L') {
      const l = LESSONS.find((x) => x.id === key);
      return { icon: '📖', name: l ? l.title : key, href: `#/lessons/${key}`, done: Store.lessonDone(key) };
    }
    if (type === 'R') {
      const r = UI.findRhythm(key);
      return { icon: '🥁', name: r ? r.name : key, href: `#/rhythms/${key}`, done: Store.rhythmDone(key) };
    }
    return { icon: '◎', name: L('Полиритм {key}', { key }), href: `#/poly/${key}`, done: Store.polyDone(key) };
  }

  function render() {
    let total = 0;
    let done = 0;
    const steps = LEARNING_PATH.map((step, i) => {
      const items = step.items.map(itemInfo);
      total += items.length;
      const d = items.filter((x) => x.done).length;
      done += d;
      const complete = d === items.length;
      return `
        <li class="path-step ${complete ? 'complete' : ''}">
          <div class="path-head"><span class="path-num">${complete ? '✓' : i + 1}</span><b>${UI.esc(step.title)}</b><span class="muted">${d}/${items.length}</span></div>
          <div class="path-items">
            ${items.map((x) => `<a class="path-item ${x.done ? 'done' : ''}" href="${x.href}"><span>${x.done ? '✅' : x.icon}</span>${UI.esc(x.name)}</a>`).join('')}
          </div>
        </li>`;
    }).join('');
    const pct = total ? Math.round((done / total) * 100) : 0;

    el.innerHTML = `
      <div class="hero card">
        <div>
          <h1>${L('Самоучитель ритмов для бонго')}</h1>
          <p class="lead">${L('Простые объяснения, 40+ ритмов от мартильо и клаве до максума и 9/8, полиритмы, метроном и тренажёр точности. Всё работает прямо в браузере и без интернета.')}</p>
          <div class="hero-actions">
            <a class="btn primary" href="#/lessons/intro">📖 ${L('Начать с первого урока')}</a>
            <a class="btn" href="#/rhythms/martillo">🥁 ${L('Сразу к мартильо')}</a>
            <a class="btn" href="#/metronome">⏱ ${L('Метроном')}</a>
          </div>
        </div>
        <div class="progress-ring" style="--p:${pct}">
          <span><b>${pct}%</b><small>${L('пройдено')}</small></span>
        </div>
      </div>

      <div class="start-grid">
        <section class="card">
          <h2>${L('План обучения')}</h2>
          <p class="muted">${L('Идите по шагам сверху вниз. Урок отмечается кнопкой «Урок пройден», ритм — кнопкой «Освоено» в плеере.')}</p>
          <ol class="path">${steps}</ol>
        </section>

        <aside class="side-col">
          <section class="card">
            <h2>${L('Что здесь есть')}</h2>
            <ul class="feature-list">
              <li>${L('<a href="#/lessons">📖 <b>Уроки</b></a> — от посадки и ударов до клаве и полиритмии.')}</li>
              <li>${L('<a href="#/rhythms">🥁 <b>Ритмы</b></a> — сетка, звук, заглушение партий, ускорение, редактор своих ритмов.')}</li>
              <li>${L('<a href="#/poly">◎ <b>Полиритмы</b></a> — любые A:B и полиметры с наглядным кругом.')}</li>
              <li>${L('<a href="#/metronome">⏱ <b>Метроном</b></a> — акценты, дробления, ускорение, «пропуски».')}</li>
              <li>${L('<a href="#/flute">🪈 <b>Флейта</b></a> — блокфлейта: аппликатура, тюнер и мелодии, приложение слушает вас через микрофон.')}</li>
              <li>${L('<a href="#/mallet">🎼 <b>Металлофон</b></a> — уроки, мелодии с подсветкой пластин, режим «Ждать меня» и запись своих мелодий.')}</li>
              <li>${L('<a href="#/keys">🎹 <b>Клавиши</b></a> — для Akai MPK mini Play (25 клавиш): мелодии, аккорды и последовательности, подключение по MIDI.')}</li>
              <li>${L('<a href="#/trainer">🎯 <b>Тренажёр</b></a> — показывает, насколько точно вы попадаете в доли, в миллисекундах.')}</li>
            </ul>
          </section>
          <section class="card">
            <h2>${L('Горячие клавиши')}</h2>
            <ul class="keys">
              <li>${L('<kbd>Пробел</kbd> — старт / стоп')}</li>
              <li>${L('<kbd>F</kbd> <kbd>J</kbd> — удары в тренажёре (эмбра / мачо)')}</li>
            </ul>
          </section>
          <section class="card">
            <h2>${L('Совет дня')}</h2>
            <p id="tip-of-day"></p>
          </section>
        </aside>
      </div>`;

    const tips = [
      L('Считайте вслух. Если не можете проговорить ритм — не сможете и сыграть.'),
      L('Медленно = быстро. Учите на темпе без ошибок и прибавляйте по 2–5 BPM.'),
      L('Звук важнее громкости: открытый тон поёт, когда рука сразу отскакивает.'),
      L('Заглушите партию бонго в плеере (нажмите на название строки) и сыграйте её сами поверх остальных.'),
      L('Мачо — слева (для правшей), эмбра — справа. Левшам — наоборот.'),
      L('15 минут каждый день дают больше, чем 3 часа раз в неделю.'),
      L('Включите в метрономе «пропуски» — проверите, держите ли вы темп сами.'),
      L('Узнавайте тресильо (3+3+2) в песнях — он повсюду, от сальсы до поп-хитов.'),
    ];
    const day = Math.floor(Date.now() / 86400000);
    el.querySelector('#tip-of-day').textContent = tips[day % tips.length];
  }

  Store.onChange(() => { if (el.classList.contains('active')) render(); });

  return { show: render };
})();
