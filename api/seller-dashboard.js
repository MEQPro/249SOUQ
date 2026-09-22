const { getServiceClient } = require('./_supabase');
const { normalizePhone } = require('./_phone');

function monthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-EG', { month: 'short', year: 'numeric' });
}

// Shared second-factor check: private dashboard slug + the seller's own
// registered phone number, same idea as a bank-statement PDF password.
async function authenticateSeller(supabase, slug, phoneInput) {
  if (!slug || !phoneInput) return { error: 'missing_credentials', status: 400 };

  const { data: seller, error: sellerErr } = await supabase
    .from('sellers')
    .select('id, name, product_name, phone, commission_percent, agreed_to_commission, agreed_to_payout_terms')
    .eq('dashboard_slug', slug)
    .maybeSingle();

  if (sellerErr) return { error: sellerErr.message, status: 500 };
  if (!seller) return { error: 'seller_not_found', status: 404 };
  if (!seller.phone) return { error: 'phone_not_set', status: 403 };

  const normalizedInput = normalizePhone(phoneInput);
  if (!normalizedInput || normalizedInput !== seller.phone) {
    return { error: 'phone_mismatch', status: 403 };
  }
  return { seller };
}

module.exports = async (req, res) => {
  const supabase = getServiceClient();

  // ---------- GET: dashboard data (sales report + this seller's own listings) ----------
  if (req.method === 'GET') {
    const slug = req.query && req.query.slug;
    const phoneInput = req.query && req.query.phone;
    const auth = await authenticateSeller(supabase, slug, phoneInput);
    if (auth.error) { res.status(auth.status).json({ error: auth.error }); return; }
    const seller = auth.seller;

    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('created_at, quantity, unit_price_seller, delivery_status')
      .eq('seller_id', seller.id)
      .order('created_at', { ascending: true });
    if (ordersErr) { res.status(500).json({ error: ordersErr.message }); return; }

    const { data: products, error: productsErr } = await supabase
      .from('products')
      .select('id, sku, name_en, name_ar, description, packaging, photos, category, wholesale_price, retail_price, payout_price, stock_status, prep_time, status, reviewer_notes, created_at')
      .eq('seller_id', seller.id)
      .order('created_at', { ascending: false });
    if (productsErr) { res.status(500).json({ error: productsErr.message }); return; }

    let totalUnits = 0, totalPayout = 0;
    const monthBuckets = {};
    const now = new Date();
    const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    let currentMonthUnits = 0, currentMonthPayout = 0, currentMonthOrders = 0;

    for (const o of orders) {
      const qty = Number(o.quantity) || 0;
      const payout = qty * (Number(o.unit_price_seller) || 0);
      totalUnits += qty;
      totalPayout += payout;

      const mk = monthKey(o.created_at);
      if (!monthBuckets[mk]) monthBuckets[mk] = { key: mk, label: monthLabel(o.created_at), units: 0, payout: 0 };
      monthBuckets[mk].units += qty;
      monthBuckets[mk].payout += payout;

      if (mk === currentMonthKey) {
        currentMonthUnits += qty;
        currentMonthPayout += payout;
        currentMonthOrders += 1;
      }
    }

    const monthlySeries = Object.values(monthBuckets).sort((a, b) => a.key.localeCompare(b.key)).slice(-6);

    const recentActivity = orders.slice(-10).reverse().map((o) => ({
      date: o.created_at,
      quantity: o.quantity,
      payout: Number(o.quantity) * Number(o.unit_price_seller),
      delivery_status: o.delivery_status
    }));

    res.status(200).json({
      seller_name: seller.name,
      product_name: seller.product_name,
      commission_percent: seller.commission_percent,
      agreed_to_commission: !!seller.agreed_to_commission,
      agreed_to_payout_terms: !!seller.agreed_to_payout_terms,
      products,
      totals: { orderCount: orders.length, totalUnits, totalPayout },
      currentMonth: { units: currentMonthUnits, payout: currentMonthPayout, orders: currentMonthOrders },
      monthlySeries,
      recentActivity
    });
    return;
  }

  // ---------- POST: submit a new product listing (goes to Gate 2 review) ----------
  if (req.method === 'POST') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const { slug, phone } = body || {};
    const auth = await authenticateSeller(supabase, slug, phone);
    if (auth.error) { res.status(auth.status).json({ error: auth.error }); return; }
    const seller = auth.seller;

    if (!seller.agreed_to_commission || !seller.agreed_to_payout_terms) {
      res.status(403).json({ error: 'terms_not_agreed' });
      return;
    }

    const {
      name_en, name_ar, description, packaging, photos,
      category, wholesale_price, stock_status, prep_time
    } = body || {};

    if (!name_en || !wholesale_price || Number(wholesale_price) <= 0) {
      res.status(400).json({ error: 'missing_required_fields' });
      return;
    }

    const { data, error } = await supabase
      .from('products')
      .insert({
        seller_id: seller.id,
        sku: null,
        name_en,
        name_ar: name_ar || null,
        description: description || null,
        packaging: packaging || null,
        photos: photos || null,
        category: category || null,
        wholesale_price: Number(wholesale_price),
        retail_price: 0,
        payout_price: 0,
        stock_status: stock_status || null,
        prep_time: prep_time || null,
        status: 'pending'
      })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ product: data });
    return;
  }

  // ---------- PATCH: seller agrees to terms, or edits price/stock on a live listing ----------
  if (req.method === 'PATCH') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const { slug, phone, product_id, wholesale_price, stock_status, agree_terms } = body || {};
    const auth = await authenticateSeller(supabase, slug, phone);
    if (auth.error) { res.status(auth.status).json({ error: auth.error }); return; }
    const seller = auth.seller;

    // Recording consent to the commission % and payout timing — shown privately
    // in the dashboard, once, before the seller can submit their first listing.
    if (agree_terms === true) {
      const { data, error } = await supabase
        .from('sellers')
        .update({ agreed_to_commission: true, agreed_to_payout_terms: true, terms_agreed_at: new Date().toISOString() })
        .eq('id', seller.id)
        .select('agreed_to_commission, agreed_to_payout_terms')
        .single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json(data);
      return;
    }

    if (!product_id) { res.status(400).json({ error: 'product_id_required' }); return; }

    const { data: product, error: prodErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', product_id)
      .eq('seller_id', seller.id)
      .maybeSingle();
    if (prodErr) { res.status(500).json({ error: prodErr.message }); return; }
    if (!product) { res.status(404).json({ error: 'product_not_found' }); return; }
    if (product.status !== 'approved') { res.status(400).json({ error: 'only_live_listings_are_editable' }); return; }

    const update = {};
    if (wholesale_price !== undefined && wholesale_price !== null && wholesale_price !== '') {
      const wholesale = Number(wholesale_price);
      const commission = Number(seller.commission_percent) || 0;
      if (!wholesale || wholesale <= 0 || !commission) { res.status(400).json({ error: 'invalid_price' }); return; }
      const retail = wholesale / (1 - commission);
      const payout = retail * (1 - commission);
      update.wholesale_price = wholesale;
      update.retail_price = retail;
      update.payout_price = payout;
    }
    if (stock_status !== undefined && stock_status !== null && stock_status !== '') {
      update.stock_status = stock_status;
    }
    if (!Object.keys(update).length) { res.status(400).json({ error: 'nothing_to_update' }); return; }

    const { data, error } = await supabase
      .from('products')
      .update(update)
      .eq('id', product_id)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ product: data });
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
