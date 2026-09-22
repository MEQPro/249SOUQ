const { setSessionCookie, clearSessionCookie } = require('./_auth');

// Handles both login and logout under one function (Vercel Hobby plan is
// capped at 12 serverless functions per deployment, so admin-logout.js was
// folded in here rather than kept as its own file).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  if (req.query && req.query.logout) {
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
    return;
  }

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
  }
  const { password } = body || {};
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    res.status(500).json({ error: 'admin_password_not_configured' });
    return;
  }
  if (password !== expected) {
    res.status(401).json({ error: 'invalid_password' });
    return;
  }
  setSessionCookie(res);
  res.status(200).json({ ok: true });
};
