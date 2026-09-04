// wizard-complete v6
// Changes from v5: pass dog_name in user metadata so the magic link email can use it.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN === "*" ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function err(msg: string, status: number, origin: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function ok(data: Record<string, unknown>, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

const VALID_ROUTES = ["alone", "evenings"] as const;
const VALID_PROBLEMS = ["alone", "evenings", "both"] as const;
const ALONE_THRESHOLDS = ["under5", "5to15", "15to30", "dontknow"];
const EVENINGS_THRESHOLDS = ["early", "dinner", "relax", "varies", "dontknow"];

type Route = typeof VALID_ROUTES[number];

function validateThreshold(route: Route, threshold: string): boolean {
  if (route === "alone") return ALONE_THRESHOLDS.includes(threshold);
  return EVENINGS_THRESHOLDS.includes(threshold);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "*";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return err("Method not allowed", 405, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err("Invalid JSON body", 400, origin); }

  const { email, dog_name, route, reported_problem, threshold } = body as {
    email?: string; dog_name?: string; route?: string;
    reported_problem?: string; threshold?: string;
  };

  if (!email || typeof email !== "string" || !email.includes("@"))
    return err("Valid email is required", 400, origin);
  if (!dog_name || typeof dog_name !== "string" || dog_name.trim().length < 1 || dog_name.trim().length > 30)
    return err("dog_name must be 1-30 characters", 400, origin);
  if (!VALID_ROUTES.includes(route as Route))
    return err("route must be 'alone' or 'evenings'", 400, origin);
  if (!VALID_PROBLEMS.includes(reported_problem as typeof VALID_PROBLEMS[number]))
    return err("reported_problem must be 'alone', 'evenings', or 'both'", 400, origin);
  if (!threshold || !validateThreshold(route as Route, threshold))
    return err(`threshold '${threshold}' is not valid for route '${route}'`, 400, origin);

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = dog_name.trim();
  const typedRoute = route as Route;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let userId: string;

  const { data: existingUsers, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) return err("Failed to check existing users", 500, origin);

  const existingUser = existingUsers.users.find(u => u.email?.toLowerCase() === cleanEmail);

  if (existingUser) {
    userId = existingUser.id;
    // Update metadata so email template has the current dog name
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { dog_name: cleanName },
    });
  } else {
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      email_confirm: false,
      user_metadata: { dog_name: cleanName },  // ← dog name in metadata
    });
    if (createErr || !newUser.user) return err("Failed to create account", 500, origin);
    userId = newUser.user.id;
  }

  await supabase.from("profiles").upsert({ id: userId, email: cleanEmail }, { onConflict: "id" });

  let dogId: string;
  const { data: existingDog } = await supabase.from("dogs").select("id").eq("owner_id", userId).maybeSingle();

  if (existingDog) {
    dogId = existingDog.id;
    await supabase.from("dogs").update({ name: cleanName }).eq("id", dogId);
  } else {
    const { data: newDog, error: dogErr } = await supabase.from("dogs").insert({ owner_id: userId, name: cleanName }).select("id").single();
    if (dogErr || !newDog) return err("Failed to create dog record", 500, origin);
    dogId = newDog.id;
  }

  await supabase.from("onboarding_answers").upsert(
    { dog_id: dogId, route: typedRoute, reported_problem, threshold },
    { onConflict: "dog_id" }
  );

  const redirectTo = `${Deno.env.get("BDC_APP_URL") ?? "https://boreddogclub.com/bdc-session.html"}?dog_id=${dogId}&day=1&week=1`;

  const { error: otpErr } = await supabase.auth.signInWithOtp({
    email: cleanEmail,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });

  if (otpErr) {
    return ok({ success: true, dog_id: dogId, magic_link_sent: false, warning: "Magic link failed to send." }, origin);
  }

  return ok({ success: true, dog_id: dogId, magic_link_sent: true }, origin);
});
