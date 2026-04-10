ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS usage_category TEXT;

ALTER TABLE public.transfers
  ALTER COLUMN to_store_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transfers_entry_type_check'
  ) THEN
    ALTER TABLE public.transfers
      ADD CONSTRAINT transfers_entry_type_check
      CHECK (entry_type IN ('transfer', 'usage'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transfers_usage_category_check'
  ) THEN
    ALTER TABLE public.transfers
      ADD CONSTRAINT transfers_usage_category_check
      CHECK (usage_category IS NULL OR usage_category IN ('expired', 'internal_use', 'gift'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transfers_usage_flow_check'
  ) THEN
    ALTER TABLE public.transfers
      ADD CONSTRAINT transfers_usage_flow_check
      CHECK (
        (entry_type = 'transfer' AND to_store_id IS NOT NULL AND usage_category IS NULL)
        OR (entry_type = 'usage' AND usage_category IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transfers_entry_type
  ON public.transfers (entry_type);

CREATE INDEX IF NOT EXISTS idx_transfers_usage_category
  ON public.transfers (usage_category);
