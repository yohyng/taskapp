/* global __LAB_STAGING__ */
import { createClient } from '@supabase/supabase-js';
import { authSession } from './auth-session.js';
import { fixtureConfig } from './staging-config.js';
import { sessionClientOptions } from './release-config.js';

// 実接続は専用モードの明示設定だけ。製品のVITE_*や試験用window設定へフォールバックしない。
export const connection = __LAB_STAGING__ || fixtureConfig(window.labAuthConfig, location.origin);
export const supabase = createClient(connection.url, connection.key, sessionClientOptions(connection));
export const isSupabaseEnabled = true;
export const sessions = authSession(supabase.auth);
if (connection.mode !== 'production') window.labAuth = { auth: supabase.auth, sessions };
