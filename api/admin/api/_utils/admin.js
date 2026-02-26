import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function requireAdmin(req) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return { ok: false, status: 401, error: "Missing Bearer token" };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return { ok: false, status: 401, error: "Invalid token" };

  const { data: profile, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profErr) return { ok: false, status: 500, error: "Profile read failed" };
  if ((profile?.role || "").toLowerCase() !== "admin")
    return { ok: false, status: 403, error: "Not authorized" };

  return { ok: true, user };
}
