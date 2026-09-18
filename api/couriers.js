const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');

module.exports = async (req, res) => {
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

  res.status(405).json({ error: 'method_not_allowed' });
};
