import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { notify } from '../components/ui/InlineNotification';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProductionTimer {
  id: string;           // unique timer ID
  planId: string;
  planItemId: string;
  productName: string;
  stepName: string;
  durationMin: number;  // total duration in minutes
  startedAt: number;    // Date.now() when started
  endsAt: number;       // Date.now() + durationMin * 60000
}

interface ProductionTimerContextValue {
  timers: ProductionTimer[];
  startTimer: (timer: Omit<ProductionTimer, 'id' | 'startedAt' | 'endsAt'> & { durationMin: number }) => string;
  stopTimer: (id: string) => void;
  getTimerRemaining: (id: string) => number; // seconds remaining, 0 if done
  activeCount: number;
}

const ProductionTimerContext = createContext<ProductionTimerContextValue | null>(null);

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ofauria_production_timers';

function loadTimers(): ProductionTimer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ProductionTimer[];
  } catch { return []; }
}

function saveTimers(timers: ProductionTimer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
}

// ---------------------------------------------------------------------------
// Audio alert — loud continuous alarm that loops until explicitly stopped
// ---------------------------------------------------------------------------

function generateAlarmWav(): string {
  const sampleRate = 44100;
  // 2-second loop: alternating high/low siren tone
  const durationSec = 2;
  const numSamples = sampleRate * durationSec;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Generate urgent siren: alternates between 880Hz and 1100Hz every 0.25s
  // with added harmonics for a louder, more urgent sound
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const cycle = Math.floor(t / 0.25) % 2;
    const baseFreq = cycle === 0 ? 880 : 1100;
    // Main tone + harmonics for richer, louder alarm
    const sample =
      Math.sin(2 * Math.PI * baseFreq * t) * 0.5 +
      Math.sin(2 * Math.PI * baseFreq * 2 * t) * 0.25 +
      Math.sin(2 * Math.PI * baseFreq * 3 * t) * 0.15;
    const s16 = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(44 + i * 2, s16, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
}

// Pre-generate alarm sound (2s loop)
const alarmDataUri = generateAlarmWav();

// Active alarm instance — loops until stopAlarm() is called
let activeAlarm: HTMLAudioElement | null = null;

function startAlarmSound() {
  try {
    stopAlarmSound(); // Stop any previous alarm
    activeAlarm = new Audio(alarmDataUri);
    activeAlarm.loop = true;
    activeAlarm.volume = 1.0;
    activeAlarm.play().catch(() => {/* ignore */});
  } catch {
    // Audio not available — silent fallback
  }
}

function stopAlarmSound() {
  if (activeAlarm) {
    activeAlarm.pause();
    activeAlarm.currentTime = 0;
    activeAlarm = null;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ProductionTimerProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<ProductionTimer[]>(loadTimers);
  const firedRef = useRef<Set<string>>(new Set());

  // Persist to localStorage on change
  useEffect(() => {
    saveTimers(timers);
  }, [timers]);

  // Tick every second to check for expired timers
  useEffect(() => {
    if (timers.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const expired: ProductionTimer[] = [];

      for (const t of timers) {
        if (now >= t.endsAt && !firedRef.current.has(t.id)) {
          firedRef.current.add(t.id);
          expired.push(t);
        }
      }

      if (expired.length > 0) {
        // Start continuous loud alarm — loops until user clicks notification
        startAlarmSound();

        // Show notifications — click navigates to plan, dismiss (X) just stops alarm
        for (const t of expired) {
          notify.warning(
            `⏰ Timer termine : ${t.stepName} — ${t.productName}`,
            {
              onClick: () => {
                stopAlarmSound();
                window.location.href = `/production/${t.planId}?launchItem=${t.planItemId}&step=${encodeURIComponent(t.stepName)}`;
              },
              onDismissAction: () => {
                stopAlarmSound();
              },
            }
          );
        }

        // Remove expired timers
        setTimers(prev => prev.filter(t => !expired.some(e => e.id === t.id)));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timers]);

  // Force re-render every second for countdown display
  const [, setTick] = useState(0);
  useEffect(() => {
    if (timers.length === 0) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [timers.length]);

  const startTimer = useCallback((input: Omit<ProductionTimer, 'id' | 'startedAt' | 'endsAt'> & { durationMin: number }): string => {
    const id = `timer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const timer: ProductionTimer = {
      ...input,
      id,
      startedAt: now,
      endsAt: now + input.durationMin * 60 * 1000,
    };

    setTimers(prev => [...prev, timer]);
    notify.success(`Chronometre lance : ${input.stepName} (${input.durationMin} min)`);
    return id;
  }, []);

  const stopTimer = useCallback((id: string) => {
    firedRef.current.delete(id);
    setTimers(prev => prev.filter(t => t.id !== id));
  }, []);

  const getTimerRemaining = useCallback((id: string): number => {
    const timer = timers.find(t => t.id === id);
    if (!timer) return 0;
    const remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
    return remaining;
  }, [timers]);

  return (
    <ProductionTimerContext.Provider
      value={{
        timers,
        startTimer,
        stopTimer,
        getTimerRemaining,
        activeCount: timers.length,
      }}
    >
      {children}
    </ProductionTimerContext.Provider>
  );
}

export function useProductionTimers() {
  const ctx = useContext(ProductionTimerContext);
  if (!ctx) throw new Error('useProductionTimers must be used inside ProductionTimerProvider');
  return ctx;
}
