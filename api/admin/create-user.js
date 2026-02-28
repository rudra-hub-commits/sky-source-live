import { supabaseAdmin, requireAdmin } from "../utils/admin";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const admin = await requireAdmin(req);
    if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

    const { email, password, username, full_name, role = "user" } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password required" });

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) return res.status(400).json({ error: error.message });

    // write profile
    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id: data.user.id,
      email,
      username: username || null,
      full_name: full_name || null,
      role,
    });

    if (pErr) return res.status(400).json({ error: pErr.message });

    return res.json({ success: true, userId: data.user.id });
  } catch (e) {
    console.error("create-user crash:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
