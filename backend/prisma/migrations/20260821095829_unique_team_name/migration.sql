-- Dedupe any pre-existing duplicate team names (rename all but the earliest of each group,
-- suffixing with the full team id so the result is guaranteed unique) before enforcing the
-- unique constraint.
UPDATE "Team" t
SET "name" = t."name" || '-' || t."id"
WHERE EXISTS (
  SELECT 1 FROM "Team" t2
  WHERE t2."name" = t."name" AND t2."id" <> t."id"
    AND (t2."createdAt" < t."createdAt" OR (t2."createdAt" = t."createdAt" AND t2."id" < t."id"))
);

CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");
