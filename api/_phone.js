function normalizePhone(raw) {
  if (!raw) return null;
  const original = String(raw).trim();
  const hasPlus = original.startsWith('+');
  const digits = original.replace(/\D/g, ''); // strip spaces, dashes, parentheses, etc.
  if (!digits) return null;

  if (hasPlus) return '+' + digits;                          // already international, e.g. +971 50 123 4567
  if (digits.startsWith('00')) return '+' + digits.slice(2);  // 00971501234567
  if (digits.startsWith('971')) return '+' + digits;          // 971501234567
  if (digits.startsWith('0') && digits.length === 10) return '+971' + digits.slice(1); // 0501234567
  if (digits.length === 9 && digits.startsWith('5')) return '+971' + digits;           // 501234567 (leading 0 dropped)
  return '+' + digits; // fallback: assume a full number just missing the +
}

module.exports = { normalizePhone };
