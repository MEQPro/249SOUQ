const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');
const { normalizePhone } = require('./_phone');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  const supabase = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('sellers')
      .select('id, name, product_name, dashboard_slug, default_payout_price, phone')
      .order('name', { ascending: true });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ sellers: data });
    return;
  }

  if (req.method === 'PUT') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const { id, name, product_name, default_payout_price, phone } = body || {};
    if (!id) { res.status(400).json({ error: 'missing_id' }); return; }

    const update = {};
    if (name !== undefined) update.name = name;
    if (product_name !== undefined) update.product_name = product_name;
    if (default_payout_price !== undefined) update.default_payout_price = default_payout_price;
    if (phone !== undefined) update.phone = phone ? normalizePhone(phone) : null;

    const { data, error } = await supabase
      .from('sellers')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ seller: data });
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const { name, product_name, dashboard_slug, default_payout_price, phone } = body || {};
    if (!name || !product_name || !dashboard_slug) {
      res.status(400).json({ error: 'missing_fields' });
      return;
    }
    const { data, error } = await supabase
      .from('sellers')
      .insert({
        name, product_name, dashboard_slug,
        default_payout_price: default_payout_price || 0,
        phone: phone ? normalizePhone(phone) : null
      })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ seller: data });
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
