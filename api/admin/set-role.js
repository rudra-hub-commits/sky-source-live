import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Missing token" });

    // ✅ Verify user using Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Invalid user" });

    // ✅ Check admin role
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile.role !== "admin") {
      return res.status(403).json({ error: "Not authorized" });
    }

    // ✅ Update role
    const { userId, role } = req.body;

    await supabaseAdmin
      .from("profiles")
      .update({ role })
      .eq("id", userId);

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function getBearerToken(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function isAdmin({ supabaseAdmin, token }) {
  const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
  const userId = decoded?.sub;
  if (!userId) return false;

  const { data: prof } = await supabaseAdmin.from("profiles").select("role").eq("id", userId).single();
  return prof?.role === "admin";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const ok = await isAdmin({ supabaseAdmin, token });
    if (!ok) return res.status(403).json({ error: "Admin only" });

    const { user_id, role } = req.body || {};
    if (!user_id || !role) return res.status(400).json({ error: "user_id and role required" });

    const safeRole = role === "admin" ? "admin" : "user";

    const { error } = await supabaseAdmin.from("profiles").update({ role: safeRole }).eq("id", user_id);
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }

}

import { supabaseAdmin, requireAdmin } from "../_utils/admin";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return res.status(adminCheck.status).json({ error: adminCheck.error });

    const { userId, role } = req.body || {};
    if (!userId || !role) return res.status(400).json({ error: "userId and role are required" });

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ role })
      .eq("id", userId);

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
