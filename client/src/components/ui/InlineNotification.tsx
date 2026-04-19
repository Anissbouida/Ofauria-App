import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

/* ────────────────────────────────────────────────
   Notification store (event-based, no context needed)
   ──────────────────────────────────────────────── */

type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface Notification {
  id: number;
  type: NotificationType;
  message: string;
  icon?: string;
  onClick?: () => void;
  onDismissAction?: () => void; // called when dismissed (X button) — e.g. stop alarm without navigating
}

type Listener = (n: Notification) => void;
const listeners = new Set<Listener>();
let nextId = 1;

function toMessage(input: unknown): string {
  // Coerce anything into a safe string so we never render an object/null as a React child.
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'number' || typeof input === 'boolean') return String(input);
  // Common API error shapes: { message }, { error }, Error instance
  const obj = input as Record<string, unknown>;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.error === 'string') return obj.error;
  if (obj.error && typeof (obj.error as Record<string, unknown>).message === 'string') {
    return (obj.error as Record<string, unknown>).message as string;
  }
  try { return JSON.stringify(input); } catch { return 'Erreur inconnue'; }
}

interface NotifyOpts {
  icon?: string;
  onClick?: () => void;
  onDismissAction?: () => void;
}

function emit(type: NotificationType, message: unknown, opts?: NotifyOpts) {
  const n: Notification = {
    id: nextId++, type, message: toMessage(message),
    icon: opts?.icon, onClick: opts?.onClick, onDismissAction: opts?.onDismissAction,
  };
  listeners.forEach(fn => fn(n));
}

/** Drop-in replacement for react-hot-toast */
export function notify(message: unknown, opts?: NotifyOpts) {
  emit('info', message, opts);
}
notify.success = (message: unknown, opts?: NotifyOpts) => emit('success', message, opts);
notify.error = (message: unknown, opts?: NotifyOpts) => emit('error', message, opts);
notify.warning = (message: unknown, opts?: NotifyOpts) => emit('warning', message, opts);

/* ────────────────────────────────────────────────
   Banner component (renders inline in the layout)
   ──────────────────────────────────────────────── */

const DURATIONS: Record<NotificationType, number> = {
  success: 4000,
  error: 8000,
  warning: 6000,
  info: 4000,
};

const STYLES: Record<NotificationType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-800', icon: 'text-green-500' },
  error:   { bg: 'bg-red-50',   border: 'border-red-300',   text: 'text-red-800',   icon: 'text-red-500' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', icon: 'text-amber-500' },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-300',  text: 'text-blue-800',  icon: 'text-blue-500' },
};

const ICONS: Record<NotificationType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

function NotificationItem({ n, onDismiss }: { n: Notification; onDismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = () => {
    // Stop alarm if any, but don't navigate
    if (n.onDismissAction) n.onDismissAction();
    setExiting(true);
    setTimeout(() => onDismiss(n.id), 300);
  };

  const s = STYLES[n.type];
  const Icon = ICONS[n.type];
  const isClickable = !!n.onClick;

  // Auto-dismiss after duration — but NOT for clickable notifications (alarm)
  useEffect(() => {
    if (isClickable) return; // Stay visible until user clicks
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(n.id), 300);
    }, DURATIONS[n.type]);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClick = () => {
    if (n.onClick) {
      n.onClick();
      dismiss();
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-3 px-4 py-3 border rounded-lg shadow-sm transition-all duration-300 ${s.bg} ${s.border} ${
        visible && !exiting ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      } ${isClickable ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] animate-pulse ring-2 ring-amber-400 shadow-lg' : ''}`}
    >
      {n.icon ? (
        <span className="text-lg shrink-0">{n.icon}</span>
      ) : (
        <Icon size={20} className={`${s.icon} shrink-0`} />
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${s.text}`}>{n.message}</p>
        {isClickable && (
          <p className={`text-xs mt-0.5 ${s.text} opacity-60`}>Cliquez pour voir le plan</p>
        )}
      </div>
      <button onClick={(e) => { e.stopPropagation(); dismiss(); }} className={`${s.text} opacity-50 hover:opacity-100 shrink-0`}>
        <X size={16} />
      </button>
    </div>
  );
}

export default function InlineNotification() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const handleNew = useCallback((n: Notification) => {
    setNotifications(prev => [...prev.slice(-4), n]); // Keep max 5
  }, []);

  const handleDismiss = useCallback((id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  useEffect(() => {
    listeners.add(handleNew);
    return () => { listeners.delete(handleNew); };
  }, [handleNew]);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg flex flex-col gap-2 px-4 pointer-events-none">
      {notifications.map(n => (
        <div key={n.id} className="pointer-events-auto">
          <NotificationItem n={n} onDismiss={handleDismiss} />
        </div>
      ))}
    </div>
  );
}
