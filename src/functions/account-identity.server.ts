import type { User } from "@supabase/supabase-js";

export type AccountIdentity = {
  hash: string;
  provider: string;
};

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function accountIdentityForUser(user: User): Promise<AccountIdentity | null> {
  const provider =
    typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "email";
  const providerId =
    user.identities?.find((identity) => identity.provider === provider)?.id ??
    user.identities?.[0]?.id ??
    "";
  const email = user.email?.trim().toLowerCase() ?? "";
  const stableIdentity = providerId || email;

  if (!stableIdentity) return null;

  return {
    provider,
    hash: await sha256(`provider:${provider}|identity:${stableIdentity}`),
  };
}
