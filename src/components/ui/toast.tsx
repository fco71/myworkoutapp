import { useEffect, useRef } from 'react';

type ToastAction = { label: string; onClick: () => void };
type ToastMessage = { id: string; text: string; kind?: 'info' | 'success' | 'error'; action?: ToastAction; duration?: number };

export function ToastContainer({ messages, onDismiss }: { messages: ToastMessage[]; onDismiss: (id: string) => void }) {
  // Keep the latest onDismiss without making it an effect dependency — otherwise every
  // parent re-render (e.g. the once-a-second workout timer) would tear down and recreate
  // the dismiss timers, so toasts would never actually auto-dismiss.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    // Schedule a one-shot dismiss for each new message; leave existing timers running.
    messages.forEach((m) => {
      if (timers.has(m.id)) return;
      // Actionable toasts (e.g. Undo) linger longer so there's time to act.
      const ms = m.duration ?? (m.action ? 8000 : 3500);
      const t = window.setTimeout(() => {
        timers.delete(m.id);
        onDismissRef.current(m.id);
      }, ms);
      timers.set(m.id, t);
    });
    // Drop timers for messages that are already gone.
    const liveIds = new Set(messages.map((m) => m.id));
    timers.forEach((t, id) => {
      if (!liveIds.has(id)) {
        clearTimeout(t);
        timers.delete(id);
      }
    });
  }, [messages]);

  // Clear everything on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return (
    <div style={{ position: 'fixed', right: 16, top: 16, zIndex: 9999 }}>
      {messages.map((m) => (
        <div key={m.id} className={`mb-2 flex max-w-sm items-center gap-3 px-3 py-2 rounded shadow ${m.kind === 'error' ? 'bg-red-600 text-white' : m.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'}`}>
          <span className="min-w-0 flex-1">{m.text}</span>
          {m.action && (
            <button
              type="button"
              onClick={() => { m.action!.onClick(); onDismiss(m.id); }}
              className="shrink-0 rounded bg-white/20 px-2 py-1 text-sm font-semibold underline-offset-2 hover:bg-white/30"
            >
              {m.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
