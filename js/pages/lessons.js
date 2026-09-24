window.Pages = window.Pages || {};

Pages.lessons = (() => {
  const el = document.getElementById('page-lessons');
  let current = LESSONS[0].id;

  function render() {
    const idx = LESSONS.findIndex((l) => l.id === current);
    const l = LESSONS[idx];
    const prev = LESSONS[idx - 1];
    const next = LESSONS[idx + 1];
    const done = Store.lessonDone(l.id);
    el.innerHTML = `
      <div class="two-col">
        <aside class="card list-col">
          <h2>Уроки</h2>
          <ol class="lesson-list">
            ${LESSONS.map((x, i) => `
              <li><a href="#/lessons/${x.id}" class="${x.id === current ? 'active' : ''} ${Store.lessonDone(x.id) ? 'done' : ''}">
                <span class="ln">${Store.lessonDone(x.id) ? '✓' : i + 1}</span>
                <span><b>${UI.esc(x.title)}</b><small>${UI.esc(x.short)}</small></span>
              </a></li>`).join('')}
          </ol>
        </aside>
        <article class="card lesson">
          <div class="lesson-kicker">Урок ${idx + 1} из ${LESSONS.length}</div>
          <h1>${UI.esc(l.title)}</h1>
          <div class="lesson-body">${l.html}</div>
          <div class="lesson-foot">
            <button class="btn ${done ? '' : 'primary'}" id="lesson-done">${done ? '✓ Урок пройден' : 'Отметить урок пройденным'}</button>
            <span class="spacer"></span>
            ${prev ? `<a class="btn" href="#/lessons/${prev.id}">← ${UI.esc(prev.title)}</a>` : ''}
            ${next ? `<a class="btn" href="#/lessons/${next.id}">${UI.esc(next.title)} →</a>` : ''}
          </div>
        </article>
      </div>`;
    el.querySelector('#lesson-done').addEventListener('click', () => {
      Store.setLesson(l.id, !done);
      if (!done && next) UI.toast('Отлично! Следующий урок: ' + next.title);
    });
  }

  Store.onChange(() => { if (el.classList.contains('active')) render(); });

  return {
    show(params) {
      if (params[0] && LESSONS.some((l) => l.id === params[0])) current = params[0];
      render();
      el.querySelector('.lesson').scrollIntoView({ block: 'nearest' });
    },
  };
})();
