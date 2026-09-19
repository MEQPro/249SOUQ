const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');
const { normalizePhone } = require('./_phone');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
  }

  const {
    customer_name, customer_phone, emirate, source_channel, address,
    seller_id, product_name, quantity,
    unit_price_customer, unit_price_seller, promo_code,
    delivery_fee_charged, delivery_cost_actual, courier_name,
    payment_method, payment_status, delivery_status, notes
  } = body || {};

  const phone = normalizePhone(customer_phone);
  if (!phone) { res.status(400).json({ error: 'customer_phone_required' }); return; }
  if (!seller_id) { res.status(400).json({ error: 'seller_id_required' }); return; }
  if (!product_name) { res.status(400).json({ error: 'product_name_required' }); return; }
  if (!quantity || Number(quantity) <= 0) { res.status(400).json({ error: 'quantity_invalid' }); return; }
  if (unit_price_customer === undefined || unit_price_seller === undefined) {
    res.status(400).json({ error: 'prices_required' });
    return;
  }

  const supabase = getServiceClient();

  // 1) Upsert customer by phone (the unique identifier)
  const { data: existingCustomer, error: findCustErr } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (findCustErr) { res.status(500).json({ error: findCustErr.message }); return; }

  let customerId = existingCustomer && existingCustomer.id;
  if (!customerId) {
    const { data: newCust, error: custErr } = await supabase
      .from('customers')
      .insert({
        phone, name: customer_name || null, emirate: emirate || null,
        source_channel: source_channel || null, address: address || null
      })
      .select('id')
      .single();
    if (custErr) { res.status(500).json({ error: custErr.message }); return; }
    customerId = newCust.id;
  } else if (customer_name || emirate || source_channel || address) {
    // Keep the profile fresh without wiping fields we weren't given this time
    const update = {};
    if (customer_name) update.name = customer_name;
    if (emirate) update.emirate = emirate;
    if (source_channel) update.source_channel = source_channel;
    if (address) update.address = address;
    await supabase.from('customers').update(update).eq('id', customerId);
  }

  // 2) Self-building courier list: find-or-create by name
  let courierId = null;
  const courierNameTrimmed = (courier_name || '').trim();
  if (courierNameTrimmed) {
    const { data: existingCourier } = await supabase
      .from('couriers')
      .select('id')
      .eq('name', courierNameTrimmed)
      .maybeSingle();
    if (existingCourier) {
      courierId = existingCourier.id;
    } else {
      const { data: newCourier, error: courierErr } = await supabase
        .from('couriers')
        .insert({ name: courierNameTrimmed })
        .select('id')
        .single();
      if (courierErr) { res.status(500).json({ error: courierErr.message }); return; }
      courierId = newCourier.id;
    }
  }

  // 3) Insert the order
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      customer_id: customerId,
      seller_id,
      product_name,
      quantity: Number(quantity),
      unit_price_customer: Number(unit_price_customer),
      unit_price_seller: Number(unit_price_seller),
      promo_code: promo_code || null,
      delivery_fee_charged: Number(delivery_fee_charged || 0),
      delivery_cost_actual: Number(delivery_cost_actual || 0),
      courier_id: courierId,
      payment_method: payment_method || 'cash_on_delivery',
      payment_status: payment_status || 'pending',
      delivery_status: delivery_status || 'preparing',
      notes: notes || null
    })
    .select()
    .single();

  if (orderErr) { res.status(500).json({ error: orderErr.message }); return; }

  res.status(200).json({ ok: true, order });
};
