const crypto = require('crypto');

const COOKIE_NAME = 'souq_admin';

// The cookie never stores the admin password itself — it stores a token
// derived from it (HMAC), so if the cookie value ever leaked it can't be
// used to learn the real password.
function sessionToken() {
  const password = process.env.ADMIN_PASSWORD || '';
  return crypto.createHmac('sha256', password).update('249souq-admin-session').digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return Boolean(cookies[COOKIE_NAME]) && cookies[COOKIE_NAME] === sessionToken();
}

function setSessionCookie(res) {
  const token = sessionToken();
  const maxAge = 60 * 60 * 8; // 8 hours
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

function requireAuth(req, res) {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'not_authenticated' });
    return false;
  }
  return true;
}

module.exports = { isAuthenticated, setSessionCookie, clearSessionCookie, requireAuth };
