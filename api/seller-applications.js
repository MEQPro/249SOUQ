const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');
const { normalizePhone } = require('./_phone');

function skuPrefix(name) {
  const firstWord = (name || '').trim().split(/\s+/)[0] || '';
  const letters = firstWord.replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters || 'SELLER').slice(0, 8);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!requireAuth(req, res)) return;
  const supabase = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('seller_applications')
      .select('*')
      .order('submitted_at', { ascending: false });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ applications: data });
    return;
  }

  if (req.method === 'PUT') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const { id, action, reviewer_notes } = body || {};
    if (!id || !['approve', 'reject'].includes(action)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    const { data: application, error: appErr } = await supabase
      .from('seller_applications')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (appErr) { res.status(500).json({ error: appErr.message }); return; }
    if (!application) { res.status(404).json({ error: 'application_not_found' }); return; }
    if (application.status !== 'pending') { res.status(400).json({ error: 'already_reviewed' }); return; }

    if (action === 'reject') {
      const { data, error } = await supabase
        .from('seller_applications')
        .update({ status: 'rejected', reviewer_notes: reviewer_notes || null })
        .eq('id', id)
        .select()
        .single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json({ application: data });
      return;
    }

    // action === 'approve' — the review screen sends the confirmed/edited values,
    // since Salwa may adjust the seller's name, slug, commission or price before accepting.
    const { seller_name, dashboard_slug, commission_percent, wholesale_price, product_name } = body || {};
    if (!seller_name || !dashboard_slug || !commission_percent || !wholesale_price || !product_name) {
      res.status(400).json({ error: 'missing_approval_fields' });
      return;
    }

    const commission = Number(commission_percent) / 100; // e.g. 25 -> 0.25
    const wholesale = Number(wholesale_price);
    if (!commission || commission <= 0 || commission >= 1 || !wholesale || wholesale <= 0) {
      res.status(400).json({ error: 'invalid_pricing' });
      return;
    }
    const retail = wholesale / (1 - commission);
    const payout = retail * (1 - commission);

    const { data: seller, error: sellerErr } = await supabase
      .from('sellers')
      .insert({
        name: seller_name,
        product_name,
        dashboard_slug,
        default_payout_price: payout,
        phone: application.phone ? normalizePhone(application.phone) : null,
        default_weight_grams: 100,
        commission_percent: commission
      })
      .select()
      .single();
    if (sellerErr) { res.status(500).json({ error: sellerErr.message }); return; }

    const sku = skuPrefix(seller_name) + '-001';
    const { error: productErr } = await supabase
      .from('products')
      .insert({
        seller_id: seller.id,
        sku,
        name_en: product_name,
        packaging: null,
        description: application.why_join || null,
        photos: application.product_photos || null,
        wholesale_price: wholesale,
        retail_price: retail,
        payout_price: payout,
        category: application.category || null,
        stock_status: application.ready_to_ship || null,
        prep_time: application.prep_time || null,
        status: 'approved'
      });
    if (productErr) { res.status(500).json({ error: productErr.message }); return; }

    const { data: updatedApp, error: updErr } = await supabase
      .from('seller_applications')
      .update({ status: 'approved', reviewer_notes: reviewer_notes || null })
      .eq('id', id)
      .select()
      .single();
    if (updErr) { res.status(500).json({ error: updErr.message }); return; }

    res.status(200).json({ application: updatedApp, seller, sku });
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
