/*
 * Синтез звуков: бонго (мачо и эмбра, все удары), клаве, колокол, шейкер,
 * бас и щелчки метронома. Всё генерируется Web Audio API — без сэмплов,
 * поэтому приложение работает офлайн и весит мало.
 */
window.Sound = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let volume = 0.8;

  function ensure() {
    if (!ctx) {
      // iOS: играть звук даже при включённом беззвучном режиме (Safari 17+)
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* нет API */ }
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.002;
      comp.release.value = 0.15;
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(comp);
      comp.connect(ctx.destination);

      const len = ctx.sampleRate; // 1 секунда белого шума
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function now() { return ensure().currentTime; }

  // --- базовые «кирпичики» ---
  function tone(t, f0, f1, dur, gain, type = 'sine', sweep = 0.035) {
    if (gain <= 0) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + Math.min(sweep, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function noise(t, dur, gain, ftype, freq, q = 1, attack = 0.001) {
    if (gain <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = ftype;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.03);
  }

  // --- бонго ---
  const DRUM_F = { macho: 540, hembra: 350 };

  function drum(which, stroke, t, vel) {
    const f = DRUM_F[which] || 440;
    const big = which === 'hembra';
    switch (stroke) {
      case 'O': // открытый тон — певучий, долгий
        tone(t, f * 1.22, f, big ? 0.42 : 0.3, 0.85 * vel);
        tone(t, f * 1.75, f * 1.6, 0.12, 0.16 * vel);
        noise(t, 0.025, 0.14 * vel, 'bandpass', 3200, 0.8);
        break;
      case 'S': // шлепок — сухой, хлёсткий
        tone(t, f * 1.25, f * 1.05, 0.07, 0.45 * vel);
        noise(t, 0.1, 0.9 * vel, 'bandpass', big ? 1900 : 2400, 1.1);
        noise(t, 0.035, 0.45 * vel, 'highpass', 5200, 0.7);
        break;
      case 'M': // закрытый (приглушённый)
        tone(t, f * 1.3, f * 1.12, 0.06, 0.6 * vel);
        noise(t, 0.025, 0.2 * vel, 'bandpass', 1500, 1);
        break;
      case 'T': // кончики пальцев
        tone(t, f * 1.65, f * 1.45, 0.04, 0.32 * vel);
        noise(t, 0.018, 0.3 * vel, 'bandpass', 4600, 1);
        break;
      case 'P': // большой палец
        tone(t, f * 1.1, f * 0.95, 0.08, 0.55 * vel);
        noise(t, 0.02, 0.12 * vel, 'lowpass', 1500, 0.7);
        break;
      case 'H': // ладонь / пятка
        tone(t, f * 0.8, f * 0.68, 0.07, 0.55 * vel);
        noise(t, 0.025, 0.14 * vel, 'lowpass', 900, 0.7);
        break;
      default:
        tone(t, f, f, 0.1, 0.5 * vel);
    }
  }

  function clave(t, vel) {
    tone(t, 2500, 2450, 0.07, 0.55 * vel, 'sine', 0.01);
    tone(t, 5100, 5000, 0.03, 0.08 * vel, 'sine', 0.01);
  }

  function bell(t, high, vel) {
    const f1 = high ? 820 : 560;
    const f2 = high ? 1210 : 835;
    const dur = high ? 0.16 : 0.32;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = high ? 2600 : 1900;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    bp.connect(g);
    g.connect(master);
    [f1, f2].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(bp);
      o.start(t);
      o.stop(t + dur + 0.03);
    });
  }

  function shaker(t, vel) {
    noise(t, 0.07, 0.35 * vel, 'highpass', 6500, 0.8, 0.012);
  }

  function bass(t, vel) {
    tone(t, 140, 52, 0.32, 0.9 * vel, 'sine', 0.06);
  }

  // Щелчок метронома. level: 2 — акцент, 1 — доля, 0.5 — дробление
  // Металлическая пластина (металлофон / глокеншпиль).
  // Обертоны свободной балки не кратны основному тону: 1 : 2.76 : 5.40.
  function bar(midi, t, vel = 1) {
    ensure();
    if (t === undefined) t = ctx.currentTime + 0.005;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const len = UIclamp(2.6 - (midi - 72) * 0.06, 0.9, 2.6); // низкие звенят дольше
    tone(t, f, f, len, 0.42 * vel, 'sine', 0.01);
    tone(t, f * 2.76, f * 2.76, len * 0.35, 0.13 * vel, 'sine', 0.01);
    tone(t, f * 5.4, f * 5.4, len * 0.12, 0.05 * vel, 'sine', 0.01);
    noise(t, 0.012, 0.12 * vel, 'highpass', 6000, 0.7);
  }
  const UIclamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Клавиши: мягкое «электропиано» — затухающие обертоны и лёгкий удар молоточка.
  function keys(midi, t, dur = 1, vel = 1) {
    ensure();
    if (t === undefined) t = ctx.currentTime + 0.005;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const len = Math.min(2.5, Math.max(0.35, dur + 0.25));
    const out = ctx.createGain();
    out.gain.setValueAtTime(1, t);
    out.gain.setValueAtTime(1, t + Math.max(0.05, dur));
    out.gain.linearRampToValueAtTime(0.0001, t + len);
    out.connect(master);
    [[1, 0.36, 1.6], [2, 0.12, 0.7], [3, 0.05, 0.35], [4.02, 0.03, 0.2]].forEach(([k, a, d]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * k;
      o.detune.value = k === 1 ? 3 : 0;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a * vel, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d * (midi < 60 ? 1.4 : 1));
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + len + 0.05);
    });
    noise(t, 0.015, 0.06 * vel, 'bandpass', 2500, 1.2);
  }

  // Блокфлейта: почти чистый тон, немного второй гармоники, дыхание и мягкое вибрато.
  function flute(midi, t, dur = 0.5, vel = 1) {
    ensure();
    if (t === undefined) t = ctx.currentTime + 0.005;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const len = Math.max(0.12, dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3 * vel, t + 0.035);
    g.gain.setValueAtTime(0.26 * vel, t + Math.max(0.05, len - 0.06));
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.05);
    g.connect(master);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 5.2;
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(f * 0.004, t + 0.35);
    lfo.connect(lfoGain);
    [[1, 1], [2, 0.12], [3, 0.04]].forEach(([k, a]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * k;
      lfoGain.connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + len + 0.1);
    });
    lfo.start(t);
    lfo.stop(t + len + 0.1);
    noise(t, 0.08, 0.05 * vel, 'bandpass', f * 2, 2, 0.02); // «чуф» в начале ноты
  }

  function click(t, level = 1, kind = 'beep', vel = 1) {
    ensure();
    const v = vel * (level >= 2 ? 1 : level >= 1 ? 0.7 : 0.38);
    if (kind === 'wood') {
      const f = level >= 2 ? 1500 : level >= 1 ? 1150 : 900;
      tone(t, f * 1.05, f, 0.05, 0.7 * v, 'sine', 0.01);
      noise(t, 0.015, 0.25 * v, 'bandpass', f * 2, 2);
    } else if (kind === 'bell') {
      bell(t, level < 2, v);
    } else if (kind === 'voice') {
      // «голосоподобный» мягкий щелчок
      const f = level >= 2 ? 880 : level >= 1 ? 660 : 520;
      tone(t, f, f, 0.08, 0.5 * v, 'triangle', 0.01);
    } else {
      const f = level >= 2 ? 1760 : level >= 1 ? 1320 : 990;
      tone(t, f, f, 0.045, 0.5 * v, 'square', 0.01);
    }
  }

  /**
   * Сыграть символ из партитуры.
   * inst: macho | hembra | clave | bell | shaker | bass
   * ch: символ удара. У бонго строчная буква — тихий (призрачный) удар.
   *     У перкуссии «X» — акцент, «x» — обычный.
   */
  function play(inst, ch, t, vel = 1) {
    ensure();
    if (!ch || ch === '.' || ch === '-') return;
    if (t === undefined) t = ctx.currentTime + 0.005;
    if (inst === 'macho' || inst === 'hembra') {
      const up = ch.toUpperCase();
      const ghost = ch !== up;
      drum(inst, up, t, vel * (ghost ? 0.33 : 0.95));
      return;
    }
    const accent = ch === ch.toUpperCase();
    const v = vel * (accent ? 1 : 0.65);
    switch (inst) {
      case 'clave': clave(t, v); break;
      case 'bell': bell(t, ch.toUpperCase() === 'U', ch === 'L' || ch === 'U' ? vel : vel * 0.6); break;
      case 'shaker': shaker(t, v); break;
      case 'bass': bass(t, v); break;
      default: clave(t, v);
    }
  }

  function setVolume(v) {
    volume = v;
    if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  }

  // Время (в шкале AudioContext) звука, который слышен в момент события.
  function eventTime(ev) {
    ensure();
    if (ev && ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.performanceTime && ts.contextTime !== undefined) {
        const evTime = ev.timeStamp || performance.now();
        return ts.contextTime + (evTime - ts.performanceTime) / 1000;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
  }

  // Разблокировать звук на первом касании (требование браузеров)
  const unlock = () => ensure();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  return {
    ensure, now, play, click, bar, flute, keys, setVolume, eventTime,
    get ctx() { return ensure(); },
  };
})();
