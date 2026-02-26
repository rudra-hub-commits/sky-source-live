import { supabaseAdmin, requireAdmin } from "../utils/admin";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const admin = await requireAdmin(req);
    if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

    const {
      email,
      password,
      role = "user",
      username = null,
      full_name = null,
    } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    // 1) Create Auth user (Admin API)
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // ✅ avoids email confirmation flow
    });

    if (createErr) {
      return res.status(400).json({ error: createErr.message });
    }

    const userId = created?.user?.id;
    if (!userId) return res.status(500).json({ error: "User created but missing user id" });

    // 2) Upsert profile row
    const profilePayload = {
      id: userId,
      email,
      role,
      username: username || null,
      full_name: full_name || null,
      updated_at: new Date().toISOString(),
    };

    const { error: profErr } = await supabaseAdmin.from("profiles").upsert(profilePayload);

    if (profErr) {
      // Rollback auth user if profile insert fails (optional but helpful)
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.status(400).json({ error: `profiles upsert failed: ${profErr.message}` });
    }

    return res.json({
      success: true,
      userId,
      email,
      role,
      username: username || null,
      full_name: full_name || null,
    });
  } catch (e) {
    console.error("create-user error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
