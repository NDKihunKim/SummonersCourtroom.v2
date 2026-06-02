import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AuthUser = {
  userId: string;
  email?: string;
  raw: User;
};

/**
 * Validate a Supabase access token and return the authenticated user.
 * Returns null if no token is provided (anonymous user).
 * Throws with a user-friendly message if the token is invalid or expired.
 *
 * This replaces the ad-hoc resolveUser / resolveVerdictResultOwner /
 * supabaseAdmin.auth.getUser patterns that were duplicated across
 * verdict-quota, verdict-feedback, timeline-window, and account functions.
 */
export async function resolveAuthUser(accessToken?: string): Promise<AuthUser | null> {
  if (!accessToken) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("Your session expired. Please sign in again.");
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? undefined,
    raw: data.user,
  };
}
