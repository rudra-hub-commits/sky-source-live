import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: "username is required" });

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin
      .from("profiles")
      .select("email")
      .ilike("username", username.trim())
      .single();

    if (error || !data?.email) return res.status(404).json({ error: "User not found" });

    return res.status(200).json({ email: data.email });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
