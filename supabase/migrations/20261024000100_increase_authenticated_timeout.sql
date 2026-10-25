-- Exact vector search can exceed Supabase's default eight-second user limit.
ALTER ROLE authenticated SET statement_timeout = '30s';
NOTIFY pgrst, 'reload config';
