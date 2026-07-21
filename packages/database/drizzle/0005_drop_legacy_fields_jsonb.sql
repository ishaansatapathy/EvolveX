INSERT INTO "form_fields" ("id", "form_id", "label", "type", "required", "sort_order", "config")
SELECT
  gen_random_uuid(),
  f."id",
  elem->>'label',
  elem->>'type',
  COALESCE((elem->>'required')::boolean, false),
  (arr.idx - 1)::integer,
  '{}'::jsonb
FROM "forms" f
CROSS JOIN LATERAL jsonb_array_elements(f."fields") WITH ORDINALITY AS arr(elem, idx)
WHERE jsonb_array_length(f."fields") > 0
  AND NOT EXISTS (SELECT 1 FROM "form_fields" ff WHERE ff."form_id" = f."id");--> statement-breakpoint
ALTER TABLE "forms" DROP COLUMN "fields";
