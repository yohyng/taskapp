import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "./lib/supabase";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setSession(null); // Supabase未設定 → 認証スキップ
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-400" />
      </div>
    );
  }

  // Supabase未設定、またはログイン済みならそのままアプリを表示
  if (!isSupabaseEnabled || session) {
    return children;
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setLoading(false);
  };

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-950 p-4">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-neutral-900 p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mb-1 text-lg font-semibold text-neutral-100">Task Space</div>
          <div className="text-xs text-neutral-500">サインインして続ける</div>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="メールアドレス"
            required
            autoFocus
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/25"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワード"
            required
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/25"
          />

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white disabled:opacity-50"
          >
            {loading ? "ログイン中…" : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
