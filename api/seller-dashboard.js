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

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  const slug = req.query && req.query.slug;
  const phoneInput = req.query && req.query.phone;
  if (!slug) { res.status(400).json({ error: 'slug_required' }); return; }
  if (!phoneInput) { res.status(400).json({ error: 'phone_required' }); return; }

  const supabase = getServiceClient();

  // Look up the seller by their private slug. Never expose the seller list itself,
  // and never accept an id here — only a slug, so this stays a private-link lookup.
  const { data: seller, error: sellerErr } = await supabase
    .from('sellers')
    .select('id, name, product_name, phone')
    .eq('dashboard_slug', slug)
    .maybeSingle();

  if (sellerErr) { res.status(500).json({ error: sellerErr.message }); return; }
  if (!seller) { res.status(404).json({ error: 'seller_not_found' }); return; }

  // Second factor: the seller's own registered phone number, same idea as a
  // bank-statement PDF password. The private slug alone is not enough.
  if (!seller.phone) { res.status(403).json({ error: 'phone_not_set' }); return; }
  const normalizedInput = normalizePhone(phoneInput);
  if (!normalizedInput || normalizedInput !== seller.phone) {
    res.status(403).json({ error: 'phone_mismatch' });
    return;
  }

  // Only the fields this seller is allowed to see about their own orders:
  // quantity and THEIR payout price — never the customer's price, name, phone, or address.
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('created_at, quantity, unit_price_seller, delivery_status')
    .eq('seller_id', seller.id)
    .order('created_at', { ascending: true });

  if (ordersErr) { res.status(500).json({ error: ordersErr.message }); return; }

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

  // Recent activity: dates, quantities and payout only — no customer data at all.
  const recentActivity = orders.slice(-10).reverse().map((o) => ({
    date: o.created_at,
    quantity: o.quantity,
    payout: Number(o.quantity) * Number(o.unit_price_seller),
    delivery_status: o.delivery_status
  }));

  res.status(200).json({
    seller_name: seller.name,
    product_name: seller.product_name,
    totals: {
      orderCount: orders.length,
      totalUnits,
      totalPayout
    },
    currentMonth: {
      units: currentMonthUnits,
      payout: currentMonthPayout,
      orders: currentMonthOrders
    },
    monthlySeries,
    recentActivity
  });
};
