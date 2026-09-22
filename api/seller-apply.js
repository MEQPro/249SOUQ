const { getServiceClient } = require('./_supabase');
const { normalizePhone } = require('./_phone');

// Public endpoint — no admin auth. This is the self-serve "انضم كبائع" form,
// so anyone can submit, but nothing here ever becomes a live seller/listing
// on its own: it only writes a 'pending' row for the admin to review.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
  }

  const {
    full_name, business_name, phone, country_city, social_handle,
    category, product_name, product_photos, is_handmade, sourcing_method,
    current_monthly_sales, current_price, wholesale_price_offered,
    ready_to_ship, prep_time, agrees_to_commission, monthly_capacity,
    biggest_challenge, why_join, agrees_to_payout_terms
  } = body || {};

  if (!full_name || !phone || !product_name || !wholesale_price_offered) {
    res.status(400).json({ error: 'missing_required_fields' });
    return;
  }
  if (agrees_to_commission !== true || agrees_to_payout_terms !== true) {
    res.status(400).json({ error: 'terms_not_accepted' });
    return;
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('seller_applications')
    .insert({
      full_name,
      business_name: business_name || null,
      phone: normalizePhone(phone),
      country_city: country_city || null,
      social_handle: social_handle || null,
      category: category || null,
      product_name,
      product_photos: product_photos || null,
      is_handmade: is_handmade || null,
      sourcing_method: sourcing_method || null,
      current_monthly_sales: current_monthly_sales || null,
      current_price: current_price || null,
      wholesale_price_offered: wholesale_price_offered || null,
      ready_to_ship: ready_to_ship || null,
      prep_time: prep_time || null,
      agrees_to_commission: true,
      monthly_capacity: monthly_capacity || null,
      biggest_challenge: biggest_challenge || null,
      why_join: why_join || null,
      agrees_to_payout_terms: true,
      status: 'pending'
    })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(200).json({ application: data });
};
