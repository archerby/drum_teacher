/*
 * «Колесо ритма»: цикл по кругу, у каждой партии своё кольцо.
 * Спицы — начала долей (групп), стрелка — текущее место, в центре — счёт.
 * Используется в плеере ритмов и в тренажёре.
 */
window.Wheel = (() => {
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const RES = { hit: '--good', off: '--bad', miss: '--danger', extra: '--danger' };

  // Цвет точки — тот же, что у клетки в сетке
  function colorVar(inst, ch) {
    const kind = (INSTRUMENTS[inst] || {}).kind;
    if (kind === 'drum') return `--st-${ch.toUpperCase()}`;
    if (kind === 'bell') return ch.toUpperCase() === 'U' ? '--st-bell-hi' : '--st-bell';
    return '--st-perc';
  }

  /**
   * canvas — <canvas>, размер берётся по ширине родителя (не больше maxSize).
   * o.total — клеток в цикле; o.starts — Set клеток-начал долей;
   * o.rings — [{p, inst, color?, you?, muted?}] снаружи внутрь;
   * o.playPos — дробная позиция стрелки или null; o.results — {клетка: 'hit'|'off'|'miss'} для кольца «you»;
   * o.marks — [{pos, res, alpha}] черточки ударов; o.hub — {big, small, color}.
   * Возвращает номер звучащей клетки (или -1).
   */
  function draw(canvas, o) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.parentElement;
    const cs = getComputedStyle(box);
    const inner = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const size = Math.max(180, Math.min(inner || 320, o.maxSize || 380));
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = size + 'px';
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);

    const total = o.total;
    const c = size / 2;
    const Rout = size * 0.4;
    const n = Math.max(o.rings.length, 1);
    const gap = Math.min(size * 0.085, (Rout - size * 0.14) / n);
    const cLine = cssVar('--line');
    const cMuted = cssVar('--muted');
    const cAcc = cssVar('--accent');
    const ang = (pos) => (pos / total) * Math.PI * 2 - Math.PI / 2;
    const nowStep = o.playPos === null || o.playPos === undefined ? -1 : Math.floor(o.playPos) % total;

    // спицы
    const rIn = Rout - gap * (n - 0.6);
    g.lineWidth = 1;
    g.strokeStyle = cLine;
    o.starts.forEach((s) => {
      const a = ang(s);
      g.globalAlpha = s === 0 ? 0.95 : 0.5;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * rIn * 0.55, c + Math.sin(a) * rIn * 0.55);
      g.lineTo(c + Math.cos(a) * (Rout + gap * 0.45), c + Math.sin(a) * (Rout + gap * 0.45));
      g.stroke();
    });
    g.globalAlpha = 1;

    o.rings.forEach((ring, ri) => {
      const rad = Rout - gap * ri;
      g.beginPath();
      g.arc(c, c, rad, 0, Math.PI * 2);
      g.strokeStyle = ring.you ? cAcc : cLine;
      g.lineWidth = ring.you ? 1.5 : 1;
      g.globalAlpha = ring.you ? 0.4 : 0.55;
      g.stroke();
      g.globalAlpha = 1;

      for (let s = 0; s < total; s++) {
        const a = ang(s);
        const x = c + Math.cos(a) * rad;
        const y = c + Math.sin(a) * rad;
        const ch = ring.p[s];
        if (!ch || ch === '.') {
          g.beginPath();
          g.arc(x, y, 1.6, 0, Math.PI * 2);
          g.fillStyle = cMuted;
          g.globalAlpha = 0.4;
          g.fill();
          g.globalAlpha = 1;
          continue;
        }
        const strong = ch === ch.toUpperCase();
        const active = s === nowStep;
        const rr = Math.max(3, (strong ? gap * 0.3 : gap * 0.2) * (active && !ring.muted ? 1.4 : 1));
        const col = cssVar(ring.color || colorVar(ring.inst, ch)) || cAcc;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        if (ring.you) {
          // цель: полый кружок, после попытки — цвет результата
          const res = o.results && o.results[s];
          if (res) {
            g.fillStyle = cssVar(RES[res]);
            g.fill();
          } else {
            g.fillStyle = cssVar('--card');
            g.fill();
            g.strokeStyle = cAcc;
            g.lineWidth = 2;
            g.stroke();
          }
        } else {
          g.fillStyle = col;
          g.globalAlpha = ring.muted ? 0.2 : strong ? 1 : 0.55;
          g.fill();
          g.globalAlpha = 1;
        }
        if (active && !ring.muted) {
          g.beginPath();
          g.arc(x, y, rr * 1.9, 0, Math.PI * 2);
          g.strokeStyle = ring.you ? cAcc : col;
          g.lineWidth = 1.5;
          g.globalAlpha = 0.5;
          g.stroke();
          g.globalAlpha = 1;
        }
      }
    });

    // черточки ударов поперёк внешнего кольца
    (o.marks || []).forEach((k) => {
      const a = ang(k.pos);
      const r1 = Rout - gap * 0.42;
      const r2 = Rout + gap * 0.42;
      g.strokeStyle = cssVar(RES[k.res] || '--good');
      g.globalAlpha = Math.max(0, k.alpha);
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
      g.stroke();
    });
    g.globalAlpha = 1;
    g.lineCap = 'butt';

    // стрелка
    if (nowStep >= 0) {
      const a = ang(o.playPos % total);
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.cos(a) * (Rout + gap * 0.5), c + Math.sin(a) * (Rout + gap * 0.5));
      g.strokeStyle = cAcc;
      g.lineWidth = 2;
      g.globalAlpha = 0.8;
      g.stroke();
      g.globalAlpha = 1;
    }

    // ступица
    g.beginPath();
    g.arc(c, c, size * 0.12, 0, Math.PI * 2);
    g.fillStyle = cssVar('--bg2');
    g.fill();
    g.strokeStyle = cLine;
    g.lineWidth = 1;
    g.stroke();
    const hub = o.hub || {};
    const big = hub.big === undefined ? '·' : String(hub.big);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = hub.color ? cssVar(hub.color) : cssVar('--text');
    g.font = `700 ${Math.round(size * (big.length > 3 ? 0.058 : 0.07))}px ui-monospace, "SF Mono", Menlo, monospace`;
    g.fillText(big, c, hub.small ? c - size * 0.018 : c + 1);
    if (hub.small) {
      g.fillStyle = cMuted;
      g.font = `600 ${Math.round(size * 0.03)}px system-ui, sans-serif`;
      g.fillText(hub.small, c, c + size * 0.045);
    }
    return nowStep;
  }

  return { draw, colorVar };
})();
