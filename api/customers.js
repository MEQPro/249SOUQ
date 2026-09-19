const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');
const { normalizePhone } = require('./_phone');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  const supabase = getServiceClient();

  if (req.method === 'GET') {
    const search = (req.query && req.query.search || '').trim();
    let query = supabase
      .from('customers')
      .select('id, name, phone, emirate, source_channel, address, created_at')
      .order('created_at', { ascending: false });

    if (search) {
      // Match on name OR phone
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ customers: data });
    return;
  }

  if (req.method === 'PUT') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const { id, name, phone, emirate, address } = body || {};
    if (!id) { res.status(400).json({ error: 'missing_id' }); return; }

    const update = {};
    if (name !== undefined) update.name = name || null;
    if (phone !== undefined) {
      const normalized = normalizePhone(phone);
      if (!normalized) { res.status(400).json({ error: 'phone_invalid' }); return; }
      update.phone = normalized;
    }
    if (emirate !== undefined) update.emirate = emirate || null;
    if (address !== undefined) update.address = address || null;

    const { data, error } = await supabase
      .from('customers')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ customer: data });
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
