ALTER TABLE public.transfers
  DROP CONSTRAINT IF EXISTS transfers_usage_category_check;

ALTER TABLE public.transfers
  ADD CONSTRAINT transfers_usage_category_check
  CHECK (
    usage_category IS NULL
    OR usage_category IN ('expired', 'internal_use', 'gift', 'other')
  );
