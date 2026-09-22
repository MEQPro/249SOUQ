const { requireAuth } = require('./_auth');
const { getServiceClient } = require('./_supabase');
const { normalizePhone } = require('./_phone');

// One file handles both the public "انضم كبائع" submission (POST, no auth)
// and the admin review screens (GET list, PUT approve/reject — both require
// admin auth). Kept together because the Vercel Hobby plan caps deployments
// at 12 serverless functions.
//
// Two-gate seller onboarding:
//   Gate 1 (this file, action on seller_applications) — vet the person. Approving
//     creates their `sellers` row + dashboard login, nothing product-specific yet.
//   Gate 2 (this file, type:'listing' actions on `products`) — review the actual
//     product listing the seller submits from their own dashboard
//     (see api/seller-dashboard.js for the seller-facing submission).

function skuPrefix(name) {
  const firstWord = (name || '').trim().split(/\s+/)[0] || '';
  const letters = firstWord.replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters || 'SELLER').slice(0, 8);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const supabase = getServiceClient();

  // ---------- PUBLIC: new application ----------
  if (req.method === 'POST') {
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
    return;
  }

  // ---------- ADMIN: everything below requires auth ----------
  if (!requireAuth(req, res)) return;

  if (req.method === 'GET') {
    // Gate 2 queue: pending product listings awaiting review, most recent first.
    if (req.query && req.query.type === 'listings') {
      const { data, error } = await supabase
        .from('products')
        .select('*, sellers(name, phone, commission_percent, dashboard_slug)')
        .order('submitted_at', { ascending: false });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.status(200).json({ listings: data });
      return;
    }

    // Gate 1 queue: seller applications (default, unchanged).
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

    // ---------- Gate 2: approve/reject a submitted product listing ----------
    if (body && body.type === 'listing') {
      const { id, action, reviewer_notes } = body;
      if (!id || !['approve', 'reject'].includes(action)) {
        res.status(400).json({ error: 'invalid_request' });
        return;
      }

      const { data: product, error: prodErr } = await supabase
        .from('products')
        .select('*, sellers(id, name, commission_percent, product_name)')
        .eq('id', id)
        .maybeSingle();
      if (prodErr) { res.status(500).json({ error: prodErr.message }); return; }
      if (!product) { res.status(404).json({ error: 'listing_not_found' }); return; }
      if (product.status !== 'pending') { res.status(400).json({ error: 'already_reviewed' }); return; }

      if (action === 'reject') {
        const { data, error } = await supabase
          .from('products')
          .update({ status: 'rejected', reviewer_notes: reviewer_notes || null, reviewed_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();
        if (error) { res.status(500).json({ error: error.message }); return; }
        res.status(200).json({ product: data });
        return;
      }

      // action === 'approve' — compute SKU + pricing from the seller's commission.
      const seller = product.sellers;
      const commission = Number(seller && seller.commission_percent) || 0;
      const wholesale = Number(product.wholesale_price) || 0;
      if (!commission || commission <= 0 || commission >= 1 || !wholesale || wholesale <= 0) {
        res.status(400).json({ error: 'invalid_pricing' });
        return;
      }
      const retail = wholesale / (1 - commission);
      const payout = retail * (1 - commission);

      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', product.seller_id)
        .eq('status', 'approved');
      const seq = String((count || 0) + 1).padStart(3, '0');
      const sku = skuPrefix(seller.name) + '-' + seq;

      const { data: updatedProduct, error: updErr } = await supabase
        .from('products')
        .update({
          status: 'approved',
          sku,
          retail_price: retail,
          payout_price: payout,
          reviewer_notes: reviewer_notes || null,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      if (updErr) { res.status(500).json({ error: updErr.message }); return; }

      // Keep the seller's headline product name in sync with their first live listing.
      if (!seller.product_name || seller.product_name === product.name_en) {
        await supabase.from('sellers').update({
          product_name: product.name_en,
          default_payout_price: payout
        }).eq('id', seller.id);
      }

      res.status(200).json({ product: updatedProduct, sku });
      return;
    }

    // ---------- Gate 1: approve/reject a seller application ----------
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

    // action === 'approve' — this only vets the seller and creates their login.
    // The actual product listing (pricing included) is submitted by the seller
    // from their own dashboard and reviewed separately at Gate 2 above.
    const { seller_name, dashboard_slug, commission_percent } = body || {};
    if (!seller_name || !dashboard_slug || !commission_percent) {
      res.status(400).json({ error: 'missing_approval_fields' });
      return;
    }

    const commission = Number(commission_percent) / 100; // e.g. 25 -> 0.25
    if (!commission || commission <= 0 || commission >= 1) {
      res.status(400).json({ error: 'invalid_pricing' });
      return;
    }

    const { data: seller, error: sellerErr } = await supabase
      .from('sellers')
      .insert({
        name: seller_name,
        product_name: application.product_name || null,
        dashboard_slug,
        default_payout_price: 0,
        phone: application.phone ? normalizePhone(application.phone) : null,
        default_weight_grams: 100,
        commission_percent: commission
      })
      .select()
      .single();
    if (sellerErr) { res.status(500).json({ error: sellerErr.message }); return; }

    const { data: updatedApp, error: updErr } = await supabase
      .from('seller_applications')
      .update({ status: 'approved', reviewer_notes: reviewer_notes || null })
      .eq('id', id)
      .select()
      .single();
    if (updErr) { res.status(500).json({ error: updErr.message }); return; }

    res.status(200).json({ application: updatedApp, seller, dashboard_slug });
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
