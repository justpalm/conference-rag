-- Existing conference records and RLS policies are preserved.
ALTER TABLE public.sentence_embeddings
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'conference'
    CHECK (source_type IN ('conference', 'scripture', 'pmg')),
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
NOTIFY pgrst, 'reload schema';
