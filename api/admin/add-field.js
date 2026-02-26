import { supabaseAdmin, requireAdmin } from "../_utils/admin";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  const { lob_id, section = "General", label, sort_order = 0 } = req.body || {};
  if (!lob_id || !label) return res.status(400).json({ error: "lob_id and label required" });

  const { data, error } = await supabaseAdmin
    .from("lob_fields")
    .insert([{ lob_id, section, label, sort_order, is_active: true }])
    .select("*")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ success: true, field: data });
}
