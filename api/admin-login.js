const { setSessionCookie } = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
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
