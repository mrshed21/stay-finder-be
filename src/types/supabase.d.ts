import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

export type BasicSupabaseClient = ReturnType<typeof createServerClient<Database>>;

declare module "hono" {
  interface ContextVariableMap {
    supabase: BasicSupabaseClient;
    user: User | null;
  }
}
