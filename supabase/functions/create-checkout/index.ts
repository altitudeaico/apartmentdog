// create-checkout — Supabase Edge Function
// Creates a Stripe Checkout Session for the week_2_4_plan.
// Called by the client CTA. Never stores the Stripe secret in the browser.
//
// Required env vars (Supabase Edge Function secrets):
//   STRIPE_SECRET_KEY   — test key: sk_test_...
//   BDC_APP_URL         — https://boreddogclub.com/bdc-session.html
//   STRIPE_PRICE_ID     — price_... (GBP £47 one-time, created in Stripe dashboard)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://fpgecjgymgosfnkrvjue.supabase.co';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const BDC_APP_URL = Deno.env.get('BDC_APP_URL') ?? 'https://boreddogclub.com/bdc-session.html';
const STRIPE_PRICE_ID = Deno.env.get('STRIPE_PRICE_ID') ?? '';

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  try {
    // ── 1. Authenticate the caller ────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return json({ error: 'Unauthorised' }, 401);
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) {
      return json({ error: 'Invalid token' }, 401);
    }

    // ── 2. Parse and validate request body ────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const dogId = body.dog_id as string | undefined;
    if (!dogId) {
      return json({ error: 'dog_id required' }, 400);
    }

    // Verify the dog belongs to this user
    const { data: dog, error: dogErr } = await sb
      .from('dogs')
      .select('id')
      .eq('id', dogId)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (dogErr || !dog) {
      return json({ error: 'Dog not found or not owned by this user' }, 403);
    }

    // ── 3. Idempotency: check for existing active entitlement ─────────────
    const { data: existing } = await sb
      .from('purchases')
      .select('id')
      .eq('dog_id', dogId)
      .eq('product_key', 'week_2_4_plan')
      .eq('status', 'active')
      .maybeSingle();

    if (existing) {
      // Already purchased — return a signal to redirect to Week 2
      return json({ already_purchased: true });
    }

    // ── 4. Create Stripe Checkout Session ─────────────────────────────────
    if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
      return json({ error: 'Stripe not configured' }, 503);
    }

    const params = new URLSearchParams({
      'mode': 'payment',
      'line_items[0][price]': STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      // Pass dog_id and user_id in metadata for webhook fulfilment
      'metadata[dog_id]': dogId,
      'metadata[user_id]': user.id,
      'metadata[product_key]': 'week_2_4_plan',
      // Success: poll entitlement then load Week 2
      'success_url': `${BDC_APP_URL}?dog_id=${dogId}&week=2&day=1&stripe=success`,
      // Cancel: return to continuation screen
      'cancel_url': `${BDC_APP_URL}?dog_id=${dogId}&stripe=cancel`,
      // Prefill email if available
      ...(user.email ? { 'customer_email': user.email } : {}),
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error('Stripe error:', session);
      return json({ error: 'Stripe session creation failed', detail: session.error?.message }, 502);
    }

    return json({ url: session.url });

  } catch (err) {
    console.error('create-checkout error:', err);
    return json({ error: 'Internal error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
