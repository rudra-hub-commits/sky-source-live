import { supabaseAdmin, requireAdmin } from "../_utils/admin";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return res.status(adminCheck.status).json({ error: adminCheck.error });

    const { name, is_active = true } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });

    const { data, error } = await supabaseAdmin
      .from("lobs")
      .insert([{ name, is_active }])
      .select("*")
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ success: true, lob: data });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
