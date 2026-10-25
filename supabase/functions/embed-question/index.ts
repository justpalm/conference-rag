import { requireUser } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

export async function handler(request: Request): Promise<Response> {
  // Browser preflight requests do not carry the user's login token.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Use POST" }, 405);
  }

  try {
    // Verify login before making any paid OpenAI request.
    await requireUser(request);

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Body must be valid JSON" }, 400);
    }
    const question = body?.question;
    if (typeof question !== "string" || !question.trim()) {
      return jsonResponse({ error: "question must be a non-empty string" }, 400);
    }
    if (question.length > 4_000) {
      return jsonResponse({ error: "question must be at most 4,000 characters" }, 400);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY secret");

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: question.trim(),
        dimensions: 1536,
        encoding_format: "float",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error("Embedding provider HTTP status:", response.status);
      return jsonResponse({ error: "Unable to generate embedding" }, 502);
    }

    const data = await response.json();
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== 1536 ||
      !embedding.every((value: unknown) => typeof value === "number" && Number.isFinite(value))) {
      return jsonResponse({ error: "Invalid embedding response" }, 502);
    }
    return jsonResponse({ embedding });
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      return jsonResponse({ error: "Sign in to ask a question" }, 401);
    }
    // Avoid logging tokens, user questions, or provider response bodies.
    console.error("embed-question request failed");
    return jsonResponse({ error: "Unable to process question" }, 500);
  }
}

Deno.serve(handler);
