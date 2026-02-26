import { supabaseAdmin, requireAdmin } from "../_utils/admin";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });

  const { data, error } = await supabaseAdmin
    .from("lobs")
    .insert([{ name, is_active: true }])
    .select("*")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ success: true, lob: data });
}
