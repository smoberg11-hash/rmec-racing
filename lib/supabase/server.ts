import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null | undefined;

export function getSupabaseConfigurationError(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return "Supabase is not configured. Set the project URL and anon or publishable key in .env.local.";
  }

  try {
    const parsedUrl = new URL(url);
    if (
      !["http:", "https:"].includes(parsedUrl.protocol) ||
      parsedUrl.pathname !== "/" ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      return "NEXT_PUBLIC_SUPABASE_URL must be the root URL of the Supabase project.";
    }
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL must be a valid Supabase project URL.";
  }

  return null;
}

export function getSupabaseServerClient(): SupabaseClient | null {
  if (supabaseClient !== undefined) {
    return supabaseClient;
  }

  if (getSupabaseConfigurationError()) {
    supabaseClient = null;
    return supabaseClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    supabaseClient = null;
    return supabaseClient;
  }

  supabaseClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}