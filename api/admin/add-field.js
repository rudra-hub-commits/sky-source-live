import { supabaseAdmin, requireAdmin } from "../_utils/admin";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return res.status(adminCheck.status).json({ error: adminCheck.error });

    const {
      lob_id,
      section = "General",
      label,
      sort_order = 0,
      is_active = true,
    } = req.body || {};

    if (!lob_id || !label) return res.status(400).json({ error: "lob_id and label are required" });

    const { data, error } = await supabaseAdmin
      .from("lob_fields")
      .insert([{ lob_id, section, label, sort_order, is_active }])
      .select("*")
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ success: true, field: data });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
