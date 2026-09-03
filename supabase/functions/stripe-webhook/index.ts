// stripe-webhook — Supabase Edge Function
// Handles Stripe webhook events.
// Only processes checkout.session.completed.
// Verifies signature before writing any data.
// Idempotent: unique constraint on stripe_checkout_session_id prevents duplicate rows.
//
// Required env vars:
//   STRIPE_WEBHOOK_SECRET   — whsec_... (from Stripe dashboard webhook config)
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://fpgecjgymgosfnkrvjue.supabase.co';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';

  // ── 1. Verify Stripe signature ────────────────────────────────────────
  let event: StripeEvent;
  try {
    event = await verifyStripeSignature(rawBody, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  // ── 2. Only handle checkout.session.completed ─────────────────────────
  if (event.type !== 'checkout.session.completed') {
    return new Response('OK — event ignored', { status: 200 });
  }

  const session = event.data.object as StripeCheckoutSession;

  // Payment must be paid (not just created)
  if (session.payment_status !== 'paid') {
    return new Response('OK — payment not yet paid', { status: 200 });
  }

  const { dog_id, user_id, product_key } = session.metadata ?? {};

  if (!dog_id || !product_key) {
    console.error('Missing metadata in session:', session.id);
    return new Response('Missing metadata', { status: 400 });
  }

  // ── 3. Write purchase row ─────────────────────────────────────────────
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { error } = await sb
    .from('purchases')
    .insert({
      dog_id,
      product_key,
      status: 'active',
      stripe_checkout_session_id: session.id,
      purchased_at: new Date().toISOString(),
    });

  // Unique constraint on stripe_checkout_session_id handles duplicates silently
  if (error) {
    if (error.code === '23505') {
      // Duplicate — already processed this session
      console.log('Duplicate webhook, already processed:', session.id);
      return new Response('OK — already processed', { status: 200 });
    }
    console.error('Purchase insert error:', error);
    return new Response('DB error', { status: 500 });
  }

  console.log('Purchase fulfilled:', { dog_id, product_key, session_id: session.id });
  return new Response('OK', { status: 200 });
});

// ── Stripe signature verification ─────────────────────────────────────────
// Reimplements Stripe's HMAC-SHA256 signature check without the Stripe SDK.

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

interface StripeCheckoutSession {
  id: string;
  payment_status: string;
  metadata?: Record<string, string>;
}

async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string
): Promise<StripeEvent> {
  const pairs = header.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = pairs['t'];
  const sig = pairs['v1'];
  if (!timestamp || !sig) throw new Error('Invalid signature header');

  // Stripe's signed payload format: timestamp + '.' + payload
  const signedPayload = `${timestamp}.${payload}`;

  // HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig_buf = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computed = Array.from(new Uint8Array(sig_buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Timing-safe comparison
  if (!timingSafeEqual(computed, sig)) {
    throw new Error('Signature mismatch');
  }

  // Reject events older than 5 minutes (replay protection)
  const eventAge = Date.now() / 1000 - parseInt(timestamp, 10);
  if (eventAge > 300) throw new Error('Webhook timestamp too old');

  return JSON.parse(payload) as StripeEvent;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
