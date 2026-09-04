// notify-day1-complete — Supabase Edge Function
// Called by the session page after D1 check-in completes.
// Fires the Resend automation event that triggers the D2–D7 return email sequence.
// Resend API key is server-side only — never exposed in browser code.
//
// Required env vars:
//   RESEND_API_KEY   — Resend sending_access key scoped to boreddogclub.com

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://fpgecjgymgosfnkrvjue.supabase.co';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  try {
    // ── 1. Authenticate caller ────────────────────────────────────────────
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorised' }, 401);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Invalid token' }, 401);

    // ── 2. Parse body ─────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { dog_id, dog_name, session_url } = body as {
      dog_id?: string;
      dog_name?: string;
      session_url?: string;
    };

    if (!dog_id) return json({ error: 'dog_id required' }, 400);

    // ── 3. Verify dog belongs to caller ───────────────────────────────────
    const { data: dog } = await sb
      .from('dogs')
      .select('id')
      .eq('id', dog_id)
      .eq('owner_id', user.id)
      .maybeSingle();

    if (!dog) return json({ error: 'Dog not found' }, 403);

    // ── 4. Owner email is required to address the Resend contact ─────────
    const ownerEmail = user.email;
    if (!ownerEmail) {
      // Anonymous user — cannot fire the email sequence
      console.log('notify-day1-complete: anonymous user, skipping event');
      return json({ ok: true, skipped: 'anonymous_user' });
    }

    // ── 5. Fire Resend automation event ───────────────────────────────────
    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured');
      return json({ error: 'Email service not configured' }, 503);
    }

    const resendRes = await fetch('https://api.resend.com/v1/automations/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        name: 'bdc.day1.complete',
        email: ownerEmail,
        payload: {
          dog_name:    dog_name || 'your dog',
          session_url: session_url || 'https://boreddogclub.com/bdc-session.html',
        },
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.json().catch(() => ({}));
      console.error('Resend event fire failed:', err);
      // Non-critical — don't fail the checkin flow
      return json({ ok: false, warning: 'Email event failed', detail: err });
    }

    return json({ ok: true });

  } catch (err) {
    console.error('notify-day1-complete error:', err);
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
