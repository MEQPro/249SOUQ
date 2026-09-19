const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  const supabase = getServiceClient();

  if (req.method === 'GET') {
    const id = req.query && req.query.id;
    if (!id) { res.status(400).json({ error: 'id_required' }); return; }

    const { data: order, error } = await supabase
      .from('orders')
      .select('*, customers(name, phone, emirate, source_channel), couriers(name), sellers(id, name, product_name)')
      .eq('id', id)
      .maybeSingle();

    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!order) { res.status(404).json({ error: 'order_not_found' }); return; }

    res.status(200).json({
      order: {
        id: order.id,
        created_at: order.created_at,
        customer_name: order.customers ? order.customers.name : null,
        customer_phone: order.customers ? order.customers.phone : null,
        emirate: order.customers ? order.customers.emirate : null,
        source_channel: order.customers ? order.customers.source_channel : null,
        seller_id: order.seller_id,
        seller_name: order.sellers ? order.sellers.name : null,
        product_name: order.product_name,
        quantity: order.quantity,
        unit_price_customer: order.unit_price_customer,
        unit_price_seller: order.unit_price_seller,
        promo_code: order.promo_code,
        delivery_fee_charged: order.delivery_fee_charged,
        delivery_cost_actual: order.delivery_cost_actual,
        courier_name: order.couriers ? order.couriers.name : '',
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        delivery_status: order.delivery_status,
        notes: order.notes
      }
    });
    return;
  }

  if (req.method === 'PUT') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const { id } = body || {};
    if (!id) { res.status(400).json({ error: 'id_required' }); return; }

    const {
      quantity, unit_price_customer, unit_price_seller, promo_code,
      delivery_fee_charged, delivery_cost_actual, courier_name,
      payment_method, payment_status, delivery_status, notes
    } = body;

    // Self-building courier list: find-or-create by name (mirrors log-order.js)
    let courierUpdate = {};
    const courierNameTrimmed = (courier_name || '').trim();
    if (courierNameTrimmed) {
      const { data: existingCourier } = await supabase
        .from('couriers')
        .select('id')
        .eq('name', courierNameTrimmed)
        .maybeSingle();
      if (existingCourier) {
        courierUpdate.courier_id = existingCourier.id;
      } else {
        const { data: newCourier, error: courierErr } = await supabase
          .from('couriers')
          .insert({ name: courierNameTrimmed })
          .select('id')
          .single();
        if (courierErr) { res.status(500).json({ error: courierErr.message }); return; }
        courierUpdate.courier_id = newCourier.id;
      }
    } else {
      courierUpdate.courier_id = null;
    }

    const update = {
      ...courierUpdate,
      quantity: Number(quantity),
      unit_price_customer: Number(unit_price_customer),
      unit_price_seller: Number(unit_price_seller),
      promo_code: promo_code || null,
      delivery_fee_charged: Number(delivery_fee_charged || 0),
      delivery_cost_actual: Number(delivery_cost_actual || 0),
      payment_method: payment_method || 'cash_on_delivery',
      payment_status: payment_status || 'pending',
      delivery_status: delivery_status || 'preparing',
      notes: notes || null
    };

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

    res.status(200).json({ ok: true, order: updated });
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
