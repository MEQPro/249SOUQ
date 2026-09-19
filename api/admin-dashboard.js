const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');

function isoWeekKey(dateStr) {
  const d = new Date(dateStr);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function weekLabel(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const supabase = getServiceClient();
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*, customers(name, phone, emirate, source_channel), couriers(name), sellers(name, product_name)')
    .order('created_at', { ascending: true });

  if (error) { res.status(500).json({ error: error.message }); return; }

  let totalRevenue = 0, totalProductMargin = 0, totalLogisticsMargin = 0, totalSellerPayout = 0;
  const customerOrderCounts = {};
  const weekBuckets = {};
  const channelBuckets = {};
  const emirateBuckets = {};
  const paymentBuckets = {};

  for (const o of orders) {
    const qty = Number(o.quantity) || 0;
    const priceCustomer = Number(o.unit_price_customer) || 0;
    const priceSeller = Number(o.unit_price_seller) || 0;
    const deliveryCharged = Number(o.delivery_fee_charged) || 0;
    const deliveryCost = Number(o.delivery_cost_actual) || 0;

    const orderRevenue = qty * priceCustomer + deliveryCharged;
    const orderProductMargin = qty * (priceCustomer - priceSeller);
    const orderLogisticsMargin = deliveryCharged - deliveryCost;
    const orderSellerPayout = qty * priceSeller;

    totalRevenue += orderRevenue;
    totalProductMargin += orderProductMargin;
    totalLogisticsMargin += orderLogisticsMargin;
    totalSellerPayout += orderSellerPayout;

    if (o.customer_id) {
      customerOrderCounts[o.customer_id] = (customerOrderCounts[o.customer_id] || 0) + 1;
    }

    const wk = isoWeekKey(o.created_at);
    if (!weekBuckets[wk]) weekBuckets[wk] = { key: wk, label: weekLabel(o.created_at), revenue: 0, orders: 0 };
    weekBuckets[wk].revenue += orderRevenue;
    weekBuckets[wk].orders += 1;

    const channel = (o.customers && o.customers.source_channel) || 'غير محدد';
    if (!channelBuckets[channel]) channelBuckets[channel] = { label: channel, orders: 0, revenue: 0 };
    channelBuckets[channel].orders += 1;
    channelBuckets[channel].revenue += orderRevenue;

    const emirate = (o.customers && o.customers.emirate) || 'غير محدد';
    if (!emirateBuckets[emirate]) emirateBuckets[emirate] = { label: emirate, orders: 0, revenue: 0 };
    emirateBuckets[emirate].orders += 1;
    emirateBuckets[emirate].revenue += orderRevenue;

    const pm = o.payment_method || 'غير محدد';
    if (!paymentBuckets[pm]) paymentBuckets[pm] = { label: pm, orders: 0 };
    paymentBuckets[pm].orders += 1;
  }

  const uniqueCustomers = Object.keys(customerOrderCounts).length;
  const repeatCustomers = Object.values(customerOrderCounts).filter((c) => c > 1).length;
  const repeatRate = uniqueCustomers ? (repeatCustomers / uniqueCustomers) * 100 : 0;

  const weeklySeries = Object.values(weekBuckets).sort((a, b) => a.key.localeCompare(b.key)).slice(-8);
  const byChannel = Object.values(channelBuckets).sort((a, b) => b.revenue - a.revenue);
  const byEmirate = Object.values(emirateBuckets).sort((a, b) => b.revenue - a.revenue);
  const byPayment = Object.values(paymentBuckets).sort((a, b) => b.orders - a.orders);

  const recentOrders = orders.slice(-15).reverse().map((o) => ({
    id: o.id,
    date: o.created_at,
    customer_name: o.customers ? o.customers.name : null,
    customer_phone: o.customers ? o.customers.phone : null,
    emirate: o.customers ? o.customers.emirate : null,
    product_name: o.product_name,
    quantity: o.quantity,
    customer_total: Number(o.quantity) * Number(o.unit_price_customer) + Number(o.delivery_fee_charged || 0),
    seller_payout: Number(o.quantity) * Number(o.unit_price_seller),
    product_margin: Number(o.quantity) * (Number(o.unit_price_customer) - Number(o.unit_price_seller)),
    logistics_margin: Number(o.delivery_fee_charged || 0) - Number(o.delivery_cost_actual || 0),
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    delivery_status: o.delivery_status,
    courier: o.couriers ? o.couriers.name : null,
    seller: o.sellers ? o.sellers.name : null
  }));

  res.status(200).json({
    totals: {
      orderCount: orders.length,
      revenue: totalRevenue,
      productMargin: totalProductMargin,
      logisticsMargin: totalLogisticsMargin,
      sellerPayout: totalSellerPayout,
      uniqueCustomers,
      repeatCustomers,
      repeatRate
    },
    weeklySeries,
    byChannel,
    byEmirate,
    byPayment,
    recentOrders
  });
};
