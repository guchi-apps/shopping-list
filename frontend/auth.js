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

  // CI専用ログインバイパス用のダミークライアント。@supabase/supabase-jsのCDN動的importを避けるため、
  // 実クライアントと同じ形（auth.getSession等）だけを持つ最小限のオブジェクトを返す。
  function createCiBypassClient(token) {
    const session = { access_token: token, user: { email: 'ci-bypass@example.com' } };
    return {
      auth: {
        async getSession() {
          return { data: { session } };
        },
        async signInWithOAuth() {
          return { error: null };
        },
        async signOut() {
          return { error: null };
        },
        async exchangeCodeForSession() {
          return { data: { session }, error: null };
        },
        onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    };
  }

  async function loadClient() {
    const res = await fetch(new URL('api/config', SCRIPT_URL));
    const { supabaseUrl, supabasePublishableKey, ciAuthBypassToken } = await res.json();
    if (ciAuthBypassToken) {
      return createCiBypassClient(ciAuthBypassToken);
    }
    const { createClient } = await import(SUPABASE_JS_URL);
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
