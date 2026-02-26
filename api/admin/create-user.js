import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

function getBearerToken(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function isAdminFromJwtAndDb({ supabaseAdmin, token }) {
  const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
  const userId = decoded?.sub;
  if (!userId) return { ok: false };

  const { data: prof, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) return { ok: false };
  return { ok: prof?.role === "admin", userId };
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

    const adminCheck = await isAdminFromJwtAndDb({ supabaseAdmin, token });
    if (!adminCheck.ok) return res.status(403).json({ error: "Admin only" });

    const { email, password, username, full_name, role } = req.body || {};
    if (!email || !password || !username) {
      return res.status(400).json({ error: "email, password, username are required" });
    }

    // 1) Create auth user
    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (cErr) return res.status(400).json({ error: cErr.message });

    const newUserId = created.user.id;

    // 2) Insert profile
    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id: newUserId,
      email,
      username,
      role: role === "admin" ? "admin" : "user",
      full_name: full_name || null,
    });

    if (pErr) return res.status(400).json({ error: pErr.message });

    return res.status(200).json({ ok: true, user_id: newUserId });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}