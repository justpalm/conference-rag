// Ask Supabase Auth to verify the token, rather than trusting decoded JWT claims.
export async function requireUser(request: Request): Promise<void> {
  const authorization = request.headers.get("Authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("Missing Supabase environment settings");

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anonKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Response("Unauthorized", { status: 401 });
  }
  if (!response.ok) throw new Error("Supabase Auth unavailable");
  const user = await response.json();
  if (!user?.id) throw new Response("Unauthorized", { status: 401 });
}
