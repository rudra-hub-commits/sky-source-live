import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { loginId } = req.body || {};
    if (!loginId) return res.status(400).json({ error: "loginId required" });

    const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // If user typed email, return it directly
    if (String(loginId).includes("@")) return res.status(200).json({ email: loginId });

    // Otherwise resolve username -> email
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .ilike("username", loginId)
      .single();

    if (error || !data?.email) return res.status(404).json({ error: "Username not found" });

    return res.status(200).json({ email: data.email });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
