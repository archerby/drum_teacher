/*
 * Точный планировщик шагов («look-ahead scheduler»).
 * JS-таймер просыпается каждые 25 мс и заранее расставляет звуки
 * по часам AudioContext, поэтому ритм не «плывёт», даже если браузер занят.
 * Одновременно играет только один транспорт.
 */
window.Transport = (() => {
  const LOOKAHEAD = 0.12; // сек — насколько вперёд планируем
  let active = null;

  // Пока идёт занятие, экран телефона не гаснет
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        const w = wakeLock;
        wakeLock = null;
        await w.release();
      }
    } catch (e) { /* не поддерживается или запрещено — не страшно */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && active) keepAwake(true);
  });

  function makeTicker(fn) {
    const fallback = () => {
      let id = null;
      return {
        start() { clearInterval(id); id = setInterval(fn, 25); },
        stop() { clearInterval(id); id = null; },
      };
    };
    // Воркер не «засыпает» в фоновой вкладке, в отличие от setInterval
    try {
      const code = "let id=null;onmessage=e=>{clearInterval(id);if(e.data==='start'){id=setInterval(()=>postMessage(0),25)}}";
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const w = new Worker(url);
      let fb = null;
      let running = false;
      w.onmessage = fn;
      w.onerror = () => { fb = fallback(); if (running) fb.start(); };
      return {
        start() { running = true; fb ? fb.start() : w.postMessage('start'); },
        stop() { running = false; fb ? fb.stop() : w.postMessage('stop'); },
      };
    } catch (e) {
      return fallback();
    }
  }

  class Transport {
    constructor() {
      this.playing = false;
      this.bpm = 90;
      this.spb = 2; // шагов на долю
      this.total = 8; // шагов в цикле
      this.queue = [];
      this.ticker = makeTicker(() => this._tick());
      this._raf = null;
      this.onStep = null; // (step, time, stepDur) — запланировать звуки
      this.onDraw = null; // (step, time) — обновить экран, когда шаг звучит
      this.onLoop = null; // () — цикл завершён (вызывается при планировании)
      this.onStop = null;
      this.onFrame = null; // (now) — каждый кадр анимации
    }

    get stepDur() { return 60 / this.bpm / this.spb; }

    start(opts = {}) {
      if (active && active !== this) active.stop();
      active = this;
      Object.assign(this, opts);
      const ctx = Sound.ensure();
      this.step = -(opts.countIn || 0);
      this.nextTime = ctx.currentTime + 0.08;
      this.queue = [];
      this.playing = true;
      keepAwake(true);
      this.ticker.start();
      this._tick();
      const frame = () => {
        if (!this.playing) return;
        const t = ctx.currentTime;
        while (this.queue.length && this.queue[0].time <= t) {
          const q = this.queue.shift();
          if (this.onDraw) this.onDraw(q.step, q.time, q.dur);
        }
        if (this.onFrame) this.onFrame(t);
        this._raf = requestAnimationFrame(frame);
      };
      this._raf = requestAnimationFrame(frame);
    }

    _tick() {
      if (!this.playing) return;
      const ctx = Sound.ctx;
      // Если вкладка долго спала — не пытаемся «догнать» пропущенные шаги
      if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
      while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
        const dur = this.stepDur;
        if (this.onStep) this.onStep(this.step, this.nextTime, dur);
        this.queue.push({ step: this.step, time: this.nextTime, dur });
        this.nextTime += dur;
        this.step++;
        if (this.step >= this.total) {
          this.step = 0;
          if (this.onLoop) this.onLoop();
        }
        if (!this.playing) break;
      }
    }

    stop() {
      if (!this.playing) return;
      this.playing = false;
      this.ticker.stop();
      cancelAnimationFrame(this._raf);
      this.queue = [];
      if (active === this) active = null;
      if (!active) keepAwake(false);
      if (this.onStop) this.onStop();
    }

    toggle(opts) { this.playing ? this.stop() : this.start(opts); }
  }

  Transport.stopAll = () => { if (active) active.stop(); };
  return Transport;
})();
