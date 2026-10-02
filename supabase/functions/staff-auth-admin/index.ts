// Supabase Edge Function: staff-auth-admin
// ---------------------------------------------------------------
// Lets a 'god' account create or reset another staff member's actual
// Supabase Auth login (email + password) directly from the Roluri
// tab in admin-3.html -- without needing to open the Supabase
// dashboard. Adding someone to staff_roles only grants permissions
// once a matching authenticated account exists; it never created the
// login itself, which is the gap this closes.
//
// Creating or updating a user's password requires the service-role
// key (auth.admin.* is not available to the anon/authenticated roles
// at all, by design -- this must happen server-side).
//
// WHO CAN CALL THIS: only a signed-in 'god' account. The caller's own
// session token (Authorization: Bearer <token>, sent automatically by
// the Supabase JS client) is verified first, then checked against
// staff_roles for a 'god' row -- same two-step pattern as the rest of
// this project's staff-only RPCs. Anything else (no token, a valid
// token for a non-god account, a bare anon key) is rejected.
//
// One action, upsert-style: given {email, password}, update the
// password if an Auth user with that email already exists, or create
// one (email_confirm: true, so they can log in immediately -- no
// confirmation email flow for an internal staff tool) if it doesn't.
// This single action covers both "+ Adauga persoana" (brand new
// person, no login yet) and "Schimba parola" on an existing row
// (which also quietly fixes any older staff_roles row added before
// this feature existed and never got a real login).
//
// DEPLOY:
//   supabase functions deploy staff-auth-admin
// ---------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: jsonHeaders });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Step 1: this really is a logged-in user's own session.
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser } } = await caller.auth.getUser();
    if (!callerUser || !callerUser.email) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: jsonHeaders });
    }

    // Step 2: that account actually holds the 'god' role. Never trust
    // a client-supplied "I'm god" flag -- staff_roles is the only
    // source of truth, read here with the service-role key so RLS
    // can't be a factor either way.
    const { data: godRow } = await admin
      .from("staff_roles")
      .select("email")
      .eq("email", callerUser.email.toLowerCase())
      .eq("role", "god")
      .maybeSingle();
    if (!godRow) {
      return new Response(JSON.stringify({ error: "forbidden -- god role required" }), { status: 403, headers: jsonHeaders });
    }

    const { email, password } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return new Response(JSON.stringify({ error: "Introduceti un email valid." }), { status: 400, headers: jsonHeaders });
    }
    if (!password || String(password).length < 6) {
      return new Response(JSON.stringify({ error: "Parola trebuie sa aiba cel putin 6 caractere." }), { status: 400, headers: jsonHeaders });
    }

    // Find an existing Auth user by email -- there's no direct
    // getUserByEmail in the admin API, so list and match. Staff counts
    // here are tiny (a handful of people), so a single page is plenty.
    const { data: listData, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) {
      console.error("staff-auth-admin: listUsers failed", listError);
      return new Response(JSON.stringify({ error: "Nu am putut verifica utilizatorii existenti." }), { status: 500, headers: jsonHeaders });
    }
    const existing = listData.users.find((u) => (u.email || "").toLowerCase() === normalizedEmail);

    if (existing) {
      const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password });
      if (updateError) {
        console.error("staff-auth-admin: updateUserById failed", updateError);
        return new Response(JSON.stringify({ error: updateError.message }), { status: 400, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({ success: true, created: false }), { headers: jsonHeaders });
    }

    const { error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
    });
    if (createError) {
      console.error("staff-auth-admin: createUser failed", createError);
      return new Response(JSON.stringify({ error: createError.message }), { status: 400, headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ success: true, created: true }), { headers: jsonHeaders });
  } catch (err) {
    console.error("staff-auth-admin error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: jsonHeaders });
  }
});
