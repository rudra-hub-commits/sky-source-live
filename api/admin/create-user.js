import { supabaseAdmin, requireAdmin } from "../_utils/admin";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  const { email, password, role = "user" } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) return res.status(400).json({ error: error.message });

  // ensure profile role
  await supabaseAdmin.from("profiles").upsert({
    id: data.user.id,
    email,
    role,
  });

  return res.json({ success: true, userId: data.user.id });
}
