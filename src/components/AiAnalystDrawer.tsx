import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Send, Sparkles, Trash2, X } from 'lucide-react';
import { AIAnalystMessage } from '../types/statigen';

interface AiAnalystDrawerProps {
  open: boolean;
  datasetName: string;
  messages: AIAnalystMessage[];
  loading: boolean;
  error: string | null;
  suggestedQuestions: string[];
  onClose: () => void;
  onSendQuestion: (question: string) => void;
  onClearHistory: () => void;
}

export const AiAnalystDrawer: React.FC<AiAnalystDrawerProps> = ({
  open,
  datasetName,
  messages,
  loading,
  error,
  suggestedQuestions,
  onClose,
  onSendQuestion,
  onClearHistory,
}) => {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open, loading]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput('');
    onSendQuestion(trimmed);
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-slate-900/25 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl"
        aria-label="AI Statistical Analyst"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#1D4ED8] shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 truncate">
                AI Statistical Analyst
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 truncate">Grounded in: {datasetName}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                title="Clear conversation"
                aria-label="Clear conversation"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close analyst drawer"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-slate-600">
                Ask any methodological or analytical question about your active dataset. Responses cite exact figures from your schema profile, cleaning audit log, weighted estimates, correlations, and subgroup tests.
              </p>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">Suggested Questions</p>
                {suggestedQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onSendQuestion(q)}
                    disabled={loading}
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-xs text-slate-700 transition-colors hover:border-[#1D4ED8]/40 hover:bg-white hover:text-slate-900"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`space-y-1 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
              >
                <p className="text-[11px] font-medium text-slate-400">
                  {msg.role === 'user' ? 'You' : 'StatiGen Analyst'} · {msg.timestamp}
                </p>
                <div
                  className={`inline-block max-w-[92%] rounded-xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap text-left ${
                    msg.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-800'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1D4ED8]" />
              <span>Evaluating workspace statistics...</span>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-800"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700" />
              <span>{error}</span>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* Input Form */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-slate-200 bg-white px-4 py-3 flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about estimates, bias, RSE, or cleaning..."
            className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1D4ED8] focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label="Send question"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#1D4ED8] text-white transition-colors hover:bg-[#1E40AF] disabled:opacity-50 shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </aside>
    </div>
  );
};
