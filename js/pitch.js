/*
 * Определение высоты звука с микрофона (для флейты).
 * Нормированная автокорреляция в диапазоне блокфлейты сопрано (≈ 400–2700 Гц).
 * Pitch.start(cb) — cb каждый кадр получает {freq, midi, cents, rms, clarity, note}
 *   note — номер MIDI в момент начала новой устойчивой ноты (иначе null), noteTime — время по часам AudioContext.
 */
window.Pitch = (() => {
  let stream = null;
  let src = null;
  let analyser = null;
  let buf = null;
  let raf = null;
  let cb = null;
  let stable = null; // текущая устойчивая нота
  let cand = null;
  let candCount = 0;
  let quiet = 0;

  const MIN_F = 400;
  const MAX_F = 2700;
  const RMS_ON = 0.012;

  function detect(data, sr) {
    let rms = 0;
    for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
    rms = Math.sqrt(rms / data.length);
    if (rms < RMS_ON) return { freq: -1, rms, clarity: 0 };
    const minLag = Math.floor(sr / MAX_F);
    const maxLag = Math.ceil(sr / MIN_F);
    const n = data.length - maxLag;
    const r = new Float32Array(maxLag + 2);
    let best = 0;
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let s = 0;
      let e1 = 0;
      let e2 = 0;
      for (let i = 0; i < n; i++) {
        const a = data[i];
        const b = data[i + lag];
        s += a * b;
        e1 += a * a;
        e2 += b * b;
      }
      r[lag] = s / (Math.sqrt(e1 * e2) || 1);
      if (r[lag] > best) best = r[lag];
    }
    if (best < 0.8) return { freq: -1, rms, clarity: best };
    // самый короткий период с корреляцией близкой к максимуму — защита от ошибки на октаву вниз
    let lag = minLag;
    for (let l = minLag + 1; l <= maxLag; l++) {
      if (r[l] >= 0.93 * best && r[l] >= r[l - 1] && r[l] >= r[l + 1]) { lag = l; break; }
    }
    // параболическое уточнение
    const a = r[lag - 1] || r[lag];
    const b = r[lag];
    const c = r[lag + 1] || r[lag];
    const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
    const period = lag + (Math.abs(shift) < 1 ? shift : 0);
    return { freq: sr / period, rms, clarity: best };
  }

  function frame() {
    analyser.getFloatTimeDomainData(buf);
    const ctx = Sound.ctx;
    const res = detect(buf, ctx.sampleRate);
    const out = { freq: res.freq, rms: res.rms, clarity: res.clarity, midi: null, cents: 0, note: null, noteTime: 0 };
    if (res.freq > 0) {
      const m = 69 + 12 * Math.log2(res.freq / 440);
      out.midi = Math.round(m);
      out.cents = Math.round((m - out.midi) * 100);
      quiet = 0;
      if (out.midi === cand) candCount++;
      else { cand = out.midi; candCount = 1; }
      // нота считается сыгранной после 3 одинаковых кадров подряд
      if (candCount === 3 && cand !== stable) {
        stable = cand;
        out.note = stable;
        out.noteTime = ctx.currentTime - (buf.length / ctx.sampleRate) - 0.05;
      }
    } else if (++quiet >= 3) {
      // тишина — следующая такая же нота снова засчитается (повторы, «ду-ду»)
      stable = null;
      cand = null;
      candCount = 0;
    }
    if (cb) cb(out);
    raf = requestAnimationFrame(frame);
  }

  async function start(onFrame) {
    cb = onFrame;
    if (stream) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no-media');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = Sound.ensure();
    src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    buf = new Float32Array(analyser.fftSize);
    src.connect(analyser); // в динамики не подключаем — иначе будет эхо
    stable = null;
    raf = requestAnimationFrame(frame);
    return true;
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = null;
    if (src) src.disconnect();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    src = null;
    cb = null;
  }

  return { start, stop, detect, get active() { return !!stream; } };
})();
