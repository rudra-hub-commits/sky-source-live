import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

function getBearerToken(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function isAdmin({ supabaseAdmin, token }) {
  const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
  const userId = decoded?.sub;
  if (!userId) return false;

  const { data: prof } = await supabaseAdmin.from("profiles").select("role").eq("id", userId).single();
  return prof?.role === "admin";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const ok = await isAdmin({ supabaseAdmin, token });
    if (!ok) return res.status(403).json({ error: "Admin only" });

    const { email, redirectTo } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });

    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }

}


import { supabaseAdmin, requireAdmin } from "../_utils/admin";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return res.status(adminCheck.status).json({ error: adminCheck.error });

    const { userId, newPassword } = req.body || {};
    if (!userId || !newPassword) {
      return res.status(400).json({ error: "userId and newPassword are required" });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

import { supabaseAdmin, requireAdmin } from "../_utils/admin";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return res.status(adminCheck.status).json({ error: adminCheck.error });

    const { userId, newPassword } = req.body || {};
    if (!userId || !newPassword) {
      return res.status(400).json({ error: "userId and newPassword are required" });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
