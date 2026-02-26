import { supabaseAdmin, requireAdmin } from "../utils/admin";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const admin = await requireAdmin(req);
    if (!admin?.ok) {
      return res.status(admin?.status || 401).json({ error: admin?.error || "Unauthorized" });
    }

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

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr) {
      return res.status(400).json({ error: createErr.message });
    }

    const userId = created?.user?.id;
    if (!userId) return res.status(500).json({ error: "User created but missing user id" });

    const { error: profErr } = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      email,
      role,
      username,
      full_name,
      updated_at: new Date().toISOString(),
    });

    if (profErr) {
      // rollback (optional)
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.status(400).json({ error: `profiles upsert failed: ${profErr.message}` });
    }

    return res.json({ success: true, userId, email, role, username, full_name });
  } catch (e) {
    console.error("create-user fatal:", e);
    return res.status(500).json({
      error: "Internal Server Error",
      detail: e?.message || String(e),
    });
  }
}
