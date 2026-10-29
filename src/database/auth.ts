import type { BasicSupabaseClient } from "../types/supabase.js";

export async function register(sb: BasicSupabaseClient, email: string, password: string): Promise<AuthUser> {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
  });
  if (!error && data.user) {
    return {
        id: data.user.id,
        email: data.user.email as string,
    };
  }
  throw error;
}

export async function login(sb: BasicSupabaseClient, email: string, password: string): Promise<AuthUser> {
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
  });
  if (!error) {
    return {
        id: data.user.id,
        email: data.user.email as string,
    };
  }
  throw error;
}

export async function getUser(sb: BasicSupabaseClient): Promise<AuthUser> {
  const { data, error } = await sb.auth.getUser();
  if (!error && data.user) {
    return {
        id: data.user.id,
        email: data.user.email as string,
    };
  }
  throw error;
}

export async function logout(sb: BasicSupabaseClient): Promise<void> {
  const { error } = await sb.auth.signOut({ scope: "local" });
  if (error) throw error;
}
