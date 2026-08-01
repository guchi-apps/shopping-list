'use strict';

const ShoppingListAuth = (() => {
  const SUPABASE_JS_URL = 'https://esm.sh/@supabase/supabase-js@2.111.0';
  // auth.jsは index.html（末尾スラッシュあり）と auth/callback.html（末尾スラッシュなし）の
  // 両方から読み込まれ、呼び出し元ページによって相対パスの基準が異なる。
  // このスクリプト自身のURL（常に {アプリルート}/auth.js）を基準にすることで、
  // どちらのページから読み込まれても正しく {アプリルート}/api/config に解決できるようにする。
  const SCRIPT_URL = document.currentScript
    ? document.currentScript.src
    : new URL('auth.js', window.location.href).href;

  let clientPromise;

  async function loadClient() {
    const [{ createClient }, res] = await Promise.all([
      import(SUPABASE_JS_URL),
      fetch(new URL('api/config', SCRIPT_URL)),
    ]);
    const { supabaseUrl, supabasePublishableKey } = await res.json();
    // このSupabaseプロジェクトのGoogleログインはPKCEではなくimplicit flow（URLの#access_token）
    // で返ってくるため、supabase-js標準の自動検出（detectSessionInUrl、デフォルトtrue）に任せる。
    return createClient(supabaseUrl, supabasePublishableKey);
  }

  function getClient() {
    if (!clientPromise) clientPromise = loadClient();
    return clientPromise;
  }

  async function getSession() {
    const supabase = await getClient();
    const { data } = await supabase.auth.getSession();
    return data.session;
  }

  async function authHeaders() {
    const session = await getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  async function signInWithGoogle() {
    const supabase = await getClient();
    const redirectTo = new URL('auth/callback', window.location.href).toString();
    return supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  }

  async function signOut() {
    const supabase = await getClient();
    await supabase.auth.signOut();
  }

  async function exchangeCodeForSession(code) {
    const supabase = await getClient();
    return supabase.auth.exchangeCodeForSession(code);
  }

  async function onAuthStateChange(callback) {
    const supabase = await getClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => callback(session, event));
    return data.subscription;
  }

  return {
    getSession,
    authHeaders,
    signInWithGoogle,
    signOut,
    exchangeCodeForSession,
    onAuthStateChange,
  };
})();
