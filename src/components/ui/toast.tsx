import { useEffect } from 'react';

export function ToastContainer({ messages, onDismiss }: { messages: { id: string; text: string; kind?: 'info' | 'success' | 'error' }[]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timers: number[] = [];
    messages.forEach((m) => {
      const t = window.setTimeout(() => onDismiss(m.id), 3500);
      timers.push(t);
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [messages, onDismiss]);

  return (
    <div style={{ position: 'fixed', right: 16, top: 16, zIndex: 9999 }}>
      {messages.map((m) => (
        <div key={m.id} className={`mb-2 max-w-sm px-3 py-2 rounded shadow ${m.kind === 'error' ? 'bg-red-600 text-white' : m.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'}`}>
          {m.text}
        </div>
      ))}
    </div>
  );
}
