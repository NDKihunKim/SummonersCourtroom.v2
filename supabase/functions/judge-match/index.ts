import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Player = {
  name: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
};

type Body = {
  matchContext: {
    queue: string;
    duration: string;
    result: string;
  };
  playerA: Player;
  playerB: Player;
  stage?: "judge" | "parse" | "timeline-window";
  context?: string;
  reasoning?: string;
  /** Riot match-v5 id (e.g. NA1_7344857921). When set with puuids, edge can call Python to fetch Riot JSON. */
  matchId?: string;
  userPuuid?: string;
  allyPuuid?: string;
  /** Optional: americas | europe | asia | sea — overrides inference from matchId prefix. */
  routingRegion?: string;
  /** Optional: max | detailed | moderate — controls Python brief verbosity (default max). */
  verbosity?: "max" | "detailed" | "moderate";
  /** For stage="timeline-window": window bounds in ms relative to game start. */
  startMs?: number;
  endMs?: number;
};

// =====================================================================
// JUDGE-STAGE FALLBACK CONTEXT
// The full-game `/contextualize` Python endpoint and its edge wrapper were
// removed (only the Specify-Time `/timeline-window` path survives in
// Python). The Judge stage still accepts a pre-built `body.context`; when
// none is supplied we fall back to this terse placeholder so the Judge
// LLM call doesn't crash on a missing string.
// =====================================================================
function contextualizePlaceholder(body: Body): string {
  const { matchContext, playerA, playerB } = body;
  const kdaA = `${playerA.kills}/${playerA.deaths}/${playerA.assists}`;
  const kdaB = `${playerB.kills}/${playerB.deaths}/${playerB.assists}`;
  return `[CONTEXT PLACEHOLDER — no pre-built context supplied]
Match: ${matchContext.queue}, lasted ${matchContext.duration}, result: ${matchContext.result}.
${playerA.name} played ${playerA.champion} and finished ${kdaA}.
${playerB.name} played ${playerB.champion} and finished ${kdaB}.`;
}

// =====================================================================
// STAGE 1B — TIMELINE WINDOW (debug feed for "Specify Time" UI)
// Proxies straight to the Python /timeline-window endpoint. Returns the
// merged participantFrames + events list as JSON — no LLM, no narrative.
// =====================================================================
async function fetchTimelineWindowFromPython(body: Body): Promise<unknown> {
  const base = Deno.env.get("CONTEXTUALIZER_URL")?.trim();
  if (!base) {
    throw new Error("CONTEXTUALIZER_URL is not configured on the edge function.");
  }
  if (!body.matchId || !body.userPuuid) {
    throw new Error("matchId and userPuuid are required for timeline-window.");
  }
  if (typeof body.startMs !== "number" || typeof body.endMs !== "number") {
    throw new Error("startMs and endMs (numbers, ms) are required.");
  }

  const url = `${base.replace(/\/$/, "")}/timeline-window`;
  const payload: Record<string, unknown> = {
    matchId: body.matchId,
    userPuuid: body.userPuuid,
    startMs: body.startMs,
    endMs: body.endMs,
  };
  if (body.routingRegion) payload.routingRegion = body.routingRegion;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  // Same defensive parsing as /contextualize: surface FastAPI's `detail`
  // arrays as a single readable error string.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave parsed = null */
  }

  if (!res.ok) {
    let detail = text;
    if (parsed && typeof parsed === "object") {
      const p = parsed as { detail?: unknown };
      if (Array.isArray(p.detail)) {
        detail = p.detail
          .map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)))
          .join("; ");
      } else if (typeof p.detail === "string") {
        detail = p.detail;
      }
    }
    throw new Error(detail || `Timeline-window HTTP ${res.status}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Timeline-window returned non-JSON body");
  }
  return parsed;
}

// =====================================================================
// STAGE 3 — VERDICT PARSER (placeholder for your Python script)
// Replace this with: await fetch("https://your-python-host/parse-verdict", ...)
// =====================================================================
function parseVerdictPlaceholder(reasoning: string, a: string, b: string): string {
  const lower = reasoning.toLowerCase();
  // Look for the model's "Verdict: <name>" line first
  const m = reasoning.match(/verdict\s*[:\-]\s*([^\n.]+)/i);
  if (m) {
    const line = m[1].toLowerCase();
    if (line.includes(a.toLowerCase())) return a;
    if (line.includes(b.toLowerCase())) return b;
  }
  // Fallback: count name mentions
  const ca = (lower.match(new RegExp(a.toLowerCase(), "g")) || []).length;
  const cb = (lower.match(new RegExp(b.toLowerCase(), "g")) || []).length;
  return cb > ca ? b : a;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Body;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const stage = body.stage ?? "judge";

    // -------- STAGE 1B: Timeline window (raw debug feed) --------
    if (stage === "timeline-window") {
      const result = await fetchTimelineWindowFromPython(body);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // -------- STAGE 3: Parse verdict --------
    if (stage === "parse") {
      const verdictName = parseVerdictPlaceholder(
        body.reasoning ?? "",
        body.playerA.name,
        body.playerB.name,
      );
      return new Response(JSON.stringify({ verdictName }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // -------- STAGE 2: Judge (Lovable AI) --------
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const contextBlock = body.context ?? contextualizePlaceholder(body);

    const systemPrompt =
      "You are the Rift Judge: a sharp, fair, slightly sassy League of Legends analyst. You will receive a contextualized match report (already translated from raw stats into human language). Decide which of the two players contributed more to the loss. Follow the OUTPUT FORMAT block in the user's brief EXACTLY: start with a single 'Verdict: <name> is more at fault.' line, then list exactly 3 numbered reasons (1., 2., 3.) — the top, biggest, most important process mistakes — each citing concrete evidence (timestamps, zones, diffs, kill log). No 4th reason, no summary paragraph, no hedging after reason 3.";

    const userPrompt = `Contextualized match report:\n\n${contextBlock}\n\nWho is more at fault for the loss? Players in question: ${body.playerA.name} vs ${body.playerB.name}.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add credits to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const reasoning =
      data?.choices?.[0]?.message?.content ?? "The Judge is speechless.";

    return new Response(JSON.stringify({ reasoning }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("judge-match error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});