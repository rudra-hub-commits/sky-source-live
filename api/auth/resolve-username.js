import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: "username required" });

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .ilike("username", username)
      .limit(1)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data?.email) return res.status(404).json({ error: "User not found" });

    // Only returning email is fine — password is still checked by Supabase Auth
    return res.status(200).json({ email: data.email });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
