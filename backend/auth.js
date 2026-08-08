'use strict';

const crypto = require('node:crypto');

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
const AUDIENCE = 'authenticated';

class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url');
}

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createVerifier({ supabaseUrl, allowedEmails, ciBypassToken }) {
  const issuer = `${String(supabaseUrl).replace(/\/$/, '')}/auth/v1`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;

  let cache = { keysByKid: new Map(), fetchedAt: 0 };

  async function fetchJwks() {
    const res = await fetch(jwksUrl);
    if (!res.ok) throw new AuthError(`JWKSの取得に失敗しました (${res.status})`, 401);
    const { keys } = await res.json();
    const map = new Map();
    for (const key of keys || []) {
      if (key.kid) map.set(key.kid, key);
    }
    return map;
  }

  async function getSigningKey(kid) {
    const isStale = Date.now() - cache.fetchedAt > JWKS_CACHE_TTL_MS;
    if (!cache.keysByKid.has(kid) || isStale) {
      cache = { keysByKid: await fetchJwks(), fetchedAt: Date.now() };
    }
    const jwk = cache.keysByKid.get(kid);
    if (!jwk) throw new AuthError('未知の鍵IDです', 401);
    return jwk;
  }

  async function verify(token) {
    if (ciBypassToken && timingSafeEqualString(token, ciBypassToken)) {
      return { email: 'ci-bypass@example.com', aud: AUDIENCE, iss: issuer };
    }

    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new AuthError('JWTの形式が不正です', 401);
    const [headerB64, payloadB64, signatureB64] = parts;

    let header;
    let payload;
    try {
      header = JSON.parse(base64UrlDecode(headerB64));
      payload = JSON.parse(base64UrlDecode(payloadB64));
    } catch {
      throw new AuthError('JWTの解析に失敗しました', 401);
    }

    if (header.alg !== 'ES256') throw new AuthError('サポートされていない署名アルゴリズムです', 401);

    const jwk = await getSigningKey(header.kid);
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const signature = base64UrlDecode(signatureB64);
    const data = Buffer.from(`${headerB64}.${payloadB64}`);
    const valid = crypto.verify('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
    if (!valid) throw new AuthError('署名の検証に失敗しました', 401);

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) {
      throw new AuthError('トークンの有効期限が切れています', 401);
    }
    if (payload.iss !== issuer) throw new AuthError('issuerが一致しません', 401);
    if (payload.aud !== AUDIENCE) throw new AuthError('audienceが一致しません', 401);

    const email = String(payload.email || '').toLowerCase();
    if (!allowedEmails.has(email)) {
      throw new AuthError('このGoogleアカウントではログインできません', 403);
    }

    return payload;
  }

  return { verify };
}

module.exports = { AuthError, createVerifier };
