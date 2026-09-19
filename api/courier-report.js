const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');

function monthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-EG', { month: 'short', year: 'numeric' });
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  const courierId = req.query && req.query.courier_id; // 'all' or a real id
  if (!courierId) { res.status(400).json({ error: 'courier_id_required' }); return; }

  const supabase = getServiceClient();

  let courierName = 'كل شركات التوصيل';
  if (courierId !== 'all') {
    const { data: courier, error: courierErr } = await supabase
      .from('couriers')
      .select('id, name')
      .eq('id', courierId)
      .maybeSingle();
    if (courierErr) { res.status(500).json({ error: courierErr.message }); return; }
    if (!courier) { res.status(404).json({ error: 'courier_not_found' }); return; }
    courierName = courier.name;
  }

  let query = supabase
    .from('orders')
    .select('id, created_at, quantity, delivery_fee_charged, delivery_cost_actual, delivery_status, product_name, courier_id, seller_id, customers(name, phone, emirate, address), sellers(name, product_name, default_weight_grams), couriers(name)')
    .order('created_at', { ascending: true });

  if (courierId !== 'all') query = query.eq('courier_id', courierId);

  const { data: orders, error: ordersErr } = await query;
  if (ordersErr) { res.status(500).json({ error: ordersErr.message }); return; }

  // Performance summary
  let totalCharged = 0, totalCost = 0, totalOrders = orders.length;
  const statusBuckets = { preparing: 0, shipped: 0, delivered: 0, cancelled: 0 };
  const monthBuckets = {};

  for (const o of orders) {
    const charged = Number(o.delivery_fee_charged) || 0;
    const cost = Number(o.delivery_cost_actual) || 0;
    totalCharged += charged;
    totalCost += cost;
    const status = o.delivery_status || 'preparing';
    if (statusBuckets[status] === undefined) statusBuckets[status] = 0;
    statusBuckets[status] += 1;

    const mk = monthKey(o.created_at);
    if (!monthBuckets[mk]) monthBuckets[mk] = { key: mk, label: monthLabel(o.created_at), orders: 0, margin: 0 };
    monthBuckets[mk].orders += 1;
    monthBuckets[mk].margin += (charged - cost);
  }

  const totalMargin = totalCharged - totalCost;
  const avgMarginPerOrder = totalOrders ? totalMargin / totalOrders : 0;
  const monthlySeries = Object.values(monthBuckets).sort((a, b) => a.key.localeCompare(b.key)).slice(-6);

  // Daily dispatch manifest: orders still awaiting pickup/dispatch
  const pendingManifest = orders
    .filter((o) => (o.delivery_status || 'preparing') === 'preparing')
    .map((o) => {
      const weightPerUnit = (o.sellers && Number(o.sellers.default_weight_grams)) || 0;
      return {
        id: o.id,
        date: o.created_at,
        customer_name: o.customers ? o.customers.name : null,
        customer_phone: o.customers ? o.customers.phone : null,
        emirate: o.customers ? o.customers.emirate : null,
        address: o.customers ? o.customers.address : null,
        product_name: o.product_name,
        quantity: o.quantity,
        weight_grams: weightPerUnit * Number(o.quantity || 0),
        courier: o.couriers ? o.couriers.name : null
      };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  res.status(200).json({
    courier_name: courierName,
    totals: {
      orderCount: totalOrders,
      totalCharged,
      totalCost,
      totalMargin,
      avgMarginPerOrder,
      statusBreakdown: statusBuckets
    },
    monthlySeries,
    pendingManifest
  });
};
