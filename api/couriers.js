const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!requireAuth(req, res)) return;
  const supabase = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('couriers')
      .select('id, name')
      .order('name', { ascending: true });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ couriers: data });
    return;
  }

  if (req.method === 'PUT') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const { id, name } = body || {};
    if (!id) { res.status(400).json({ error: 'missing_id' }); return; }
    if (!name || !name.trim()) { res.status(400).json({ error: 'name_required' }); return; }

    const { data, error } = await supabase
      .from('couriers')
      .update({ name: name.trim() })
      .eq('id', id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ courier: data });
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const { name } = body || {};
    if (!name || !name.trim()) { res.status(400).json({ error: 'name_required' }); return; }

    const { data, error } = await supabase
      .from('couriers')
      .insert({ name: name.trim() })
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ courier: data });
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
