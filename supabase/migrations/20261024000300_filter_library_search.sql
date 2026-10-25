-- Separate RPC preserves the original tutorial function for existing clients.
CREATE OR REPLACE FUNCTION public.match_library_sentences(
  query_embedding vector(1536),
  source_types text[] DEFAULT ARRAY['conference', 'scripture', 'pmg'],
  match_count integer DEFAULT 20
)
RETURNS TABLE (
  id uuid, talk_id uuid, title text, speaker text, text text, url text,
  source_type text, source_metadata jsonb, similarity double precision
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT s.id, s.talk_id, s.title, s.speaker, s.text, s.url,
    s.source_type, s.source_metadata,
    1 - (s.embedding <=> query_embedding) AS similarity
  FROM public.sentence_embeddings s
  WHERE s.source_type = ANY(source_types) AND s.embedding IS NOT NULL
  ORDER BY s.embedding <=> query_embedding
  LIMIT greatest(1, least(coalesce(match_count, 20), 50));
$$;
NOTIFY pgrst, 'reload schema';
