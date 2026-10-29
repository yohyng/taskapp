import { createClient } from '@supabase/supabase-js';
import { authSession } from './auth-session.js';

// 本体のSDKとAuthGateを使う合成試験。環境変数を読まず、同一オリジンの使い捨てAuthだけへ接続する。
const config = window.labAuthConfig;
if (!config?.key || !config?.docId) throw new Error('認証検証の設定が必要です');
export const supabase = createClient(location.origin, config.key, { auth: { storageKey: `taskspace-lab-auth-${config.docId}`, detectSessionInUrl: false } });
export const isSupabaseEnabled = true;
export const sessions = authSession(supabase.auth);
window.labAuth = { auth: supabase.auth, sessions };
