/**
 * Sound, synthesised on the fly.
 *
 * Nothing is downloaded: a stone landing is a short noise burst through a
 * band-pass filter plus a low "tock", which is close enough to a pebble
 * dropping into a wooden pit. Everything is built the same way so the whole
 * sound design costs a few kilobytes.
 */

let ctx = null;
let master = null;
let enabled = true;
let noiseBuffer = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const len = Math.floor(ctx.sampleRate * 0.4);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function setEnabled(v) {
  enabled = !!v;
}

/** Browsers hold audio until a gesture; call this from the first click. */
export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

function noise(when, dur, freq, q, gain) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(when);
  src.stop(when + dur + 0.02);
}

function tone(when, dur, freq, gain, type = 'sine', endFreq = null) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, when + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g).connect(master);
  o.start(when);
  o.stop(when + dur + 0.02);
}

/**
 * @param {string} name
 * @param {number} v  0..1 variation, used to detune repeated sounds so a long
 *                    sowing run doesn't turn into a machine gun.
 */
export function play(name, v = Math.random()) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  const t = c.currentTime + 0.001;

  switch (name) {
    case 'stone':
      noise(t, 0.05, 1500 + v * 1400, 3.2, 0.22);
      tone(t, 0.06, 150 + v * 50, 0.16, 'triangle');
      break;
    case 'pickup':
      noise(t, 0.16, 900 + v * 400, 1.2, 0.16);
      break;
    case 'capture':
      tone(t, 0.5, 523.25, 0.2);
      tone(t + 0.055, 0.5, 783.99, 0.17);
      tone(t + 0.11, 0.62, 1046.5, 0.13);
      noise(t, 0.22, 3200, 2, 0.07);
      break;
    case 'relay':
      tone(t, 0.16, 440, 0.13, 'triangle', 660);
      break;
    case 'turn':
      tone(t, 0.12, 320, 0.1, 'sine', 240);
      break;
    case 'ui':
      noise(t, 0.03, 2400, 4, 0.1);
      break;
    case 'sweep':
      for (let i = 0; i < 6; i++) noise(t + i * 0.045, 0.09, 1200 + i * 320, 2, 0.14);
      break;
    case 'win':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(t + i * 0.1, 0.7, f, 0.18)
      );
      break;
    case 'lose':
      [392, 349.23, 293.66].forEach((f, i) => tone(t + i * 0.13, 0.6, f, 0.16, 'triangle'));
      break;
    case 'draw':
      tone(t, 0.5, 440, 0.16);
      tone(t + 0.12, 0.6, 440, 0.13);
      break;
  }
}
