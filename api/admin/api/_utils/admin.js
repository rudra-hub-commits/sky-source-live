// api/utils/admin.js
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !service) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars");
}

export const supabaseAdmin = createClient(url, service, {
  auth: { persistSession: false },
});

export async function requireAdmin(req) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) return { ok: false, status: 401, error: "Missing bearer token" };

    // Validate the JWT and fetch user
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return { ok: false, status: 401, error: "Invalid session" };

    const user = data.user;

    // Check role in profiles
    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (pErr) return { ok: false, status: 500, error: pErr.message };
    if ((profile?.role || "user") !== "admin") return { ok: false, status: 403, error: "Admin only" };

    return { ok: true, status: 200, user };
  } catch (e) {
    return { ok: false, status: 500, error: e?.message || "requireAdmin failed" };
  }
}
