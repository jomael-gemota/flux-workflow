import { useState, type ReactNode } from 'react';
import { KeyRound } from 'lucide-react';

const STORAGE_KEY = 'wap_api_key';

export function ApiKeyGate({ children }: { children: ReactNode }) {
  const [key, setKey] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  if (key) return <>{children}</>;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) {
      setError('Please enter your API key.');
      return;
    }
    localStorage.setItem(STORAGE_KEY, input.trim());
    setKey(input.trim());
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-blue-600 p-2 rounded-lg">
            <KeyRound className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-gray-900 dark:text-white font-bold text-lg">Workflow Automation Platform</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Enter your API key to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(''); }}
              placeholder="sk-..."
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
            {error && <p className="text-red-500 dark:text-red-400 text-xs mt-1">{error}</p>}
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm"
          >
            Continue
          </button>
        </form>

        <p className="text-slate-400 dark:text-slate-500 text-xs mt-4 text-center">
          The key is stored locally in your browser.
        </p>
      </div>
    </div>
  );
}
