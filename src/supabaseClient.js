import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anon);

if (typeof window !== "undefined") {
  window.supabase = supabase;
  console.log("✅ window.supabase set from supabaseClient.js", supabase);
}
