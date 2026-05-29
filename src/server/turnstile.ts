import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const TurnstileTokenSchema = z.string().min(1).max(2048).optional();

type TurnstileSiteverifyResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

function turnstileSecret(): string | null {
  return process.env.TURNSTILE_SECRET_KEY || null;
}

function isLocalRequest(): boolean {
  const request = getRequest();
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function requestIp(): string | undefined {
  const request = getRequest();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    forwarded ??
    undefined
  );
}

export async function assertTurnstile(token: string | undefined) {
  const secret = turnstileSecret();
  if (isLocalRequest() || import.meta.env.DEV) return;
  if (!secret) {
    console.error(
      "[turnstile] TURNSTILE_SECRET_KEY is missing for a protected production request.",
    );
    throw new Error("Human verification is unavailable. Please try again later.");
  }
  if (!token) throw new Error("Human verification is required. Please try again.");

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: requestIp(),
    }),
  });

  if (!response.ok) {
    throw new Error("Human verification failed. Please try again.");
  }

  const result = (await response.json()) as TurnstileSiteverifyResponse;
  if (!result.success) {
    throw new Error("Human verification failed. Please try again.");
  }
}
