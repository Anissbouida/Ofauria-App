// Sons de caisse du POS (parametre local du poste, cf. terminal-settings).
//
// Genere par WebAudio (aucun fichier audio a charger) : un AudioContext
// partage, cree paresseusement au premier son — donc toujours apres un geste
// utilisateur (clic produit / encaissement), ce qui satisfait les politiques
// d'autoplay des navigateurs.
import { getTerminalSettings } from './terminal-settings';

let ctx: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(ac: AudioContext, freq: number, startMs: number, durMs: number, type: OscillatorType = 'sine', gain = 0.08) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ac.currentTime + startMs / 1000;
  const t1 = t0 + durMs / 1000;
  // Petite enveloppe pour eviter les clics audio en debut/fin de note.
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.setValueAtTime(gain, t1 - 0.01);
  g.gain.linearRampToValueAtTime(0, t1);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t1);
}

export type PosSound = 'add' | 'success' | 'error';

export function playPosSound(kind: PosSound): void {
  if (!getTerminalSettings().sounds) return;
  const ac = ensureContext();
  if (!ac) return;
  try {
    if (kind === 'add') {
      tone(ac, 880, 0, 70);
    } else if (kind === 'success') {
      tone(ac, 660, 0, 90);
      tone(ac, 990, 100, 120);
    } else {
      tone(ac, 220, 0, 220, 'square', 0.05);
    }
  } catch { /* le son ne doit jamais casser la caisse */ }
}
