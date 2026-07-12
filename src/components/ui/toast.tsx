import { useEffect } from 'react';

type ToastAction = { label: string; onClick: () => void };
type ToastMessage = { id: string; text: string; kind?: 'info' | 'success' | 'error'; action?: ToastAction; duration?: number };

export function ToastContainer({ messages, onDismiss }: { messages: ToastMessage[]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timers: number[] = [];
    messages.forEach((m) => {
      // Actionable toasts (e.g. Undo) linger longer so there's time to act.
      const ms = m.duration ?? (m.action ? 8000 : 3500);
      const t = window.setTimeout(() => onDismiss(m.id), ms);
      timers.push(t);
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [messages, onDismiss]);

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
