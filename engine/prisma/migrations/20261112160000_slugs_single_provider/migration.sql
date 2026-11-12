-- Nothing is addressed by its position any more: criteria, requirements and
-- resources get a slug unique in their node, messages a handle (m-xxxxxx).
-- Every requirement is provided by exactly one former node: those with no
-- provider are deleted (decided 2026-11-12), the provider table becomes a column.

-- 1. Requirements without a provider go.
DELETE FROM "Requirement" r
WHERE NOT EXISTS (SELECT 1 FROM "RequirementProvider" p WHERE p."requirementId" = r."id");

-- 2. One provider per requirement, as a column.
ALTER TABLE "Requirement" ADD COLUMN "providerId" TEXT;
UPDATE "Requirement" r
SET "providerId" = (
    SELECT p."nodeId" FROM "RequirementProvider" p
    JOIN "Node" n ON n."id" = p."nodeId"
    WHERE p."requirementId" = r."id"
    ORDER BY n."seq" LIMIT 1
);
ALTER TABLE "Requirement" ALTER COLUMN "providerId" SET NOT NULL;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Requirement_providerId_idx" ON "Requirement"("providerId");
ALTER TABLE "Requirement" DROP COLUMN "met";
DROP TABLE "RequirementProvider";

-- 3. Slugs, from the text (the name for resources), made unique in the node.
CREATE FUNCTION "_rb_slug"(t TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
    SELECT COALESCE(NULLIF(LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(t), '[^a-z0-9]+', '-', 'g')), 40), ''), 'item')
$$;

ALTER TABLE "Criterion" ADD COLUMN "slug" TEXT;
UPDATE "Criterion" c SET "slug" = s."slug" FROM (
    SELECT "id", "_rb_slug"("text") || CASE WHEN n > 1 THEN '-' || n ELSE '' END AS "slug"
    FROM (SELECT "id", "text", ROW_NUMBER() OVER (PARTITION BY "nodeId", "_rb_slug"("text") ORDER BY "position") AS n FROM "Criterion") x
) s WHERE s."id" = c."id";
ALTER TABLE "Criterion" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Criterion_nodeId_slug_key" ON "Criterion"("nodeId", "slug");

ALTER TABLE "Requirement" ADD COLUMN "slug" TEXT;
UPDATE "Requirement" c SET "slug" = s."slug" FROM (
    SELECT "id", "_rb_slug"("text") || CASE WHEN n > 1 THEN '-' || n ELSE '' END AS "slug"
    FROM (SELECT "id", "text", ROW_NUMBER() OVER (PARTITION BY "nodeId", "_rb_slug"("text") ORDER BY "position") AS n FROM "Requirement") x
) s WHERE s."id" = c."id";
ALTER TABLE "Requirement" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Requirement_nodeId_slug_key" ON "Requirement"("nodeId", "slug");

ALTER TABLE "ResourceNeed" ADD COLUMN "slug" TEXT;
UPDATE "ResourceNeed" c SET "slug" = s."slug" FROM (
    SELECT "id", "_rb_slug"("name") || CASE WHEN n > 1 THEN '-' || n ELSE '' END AS "slug"
    FROM (SELECT "id", "name", ROW_NUMBER() OVER (PARTITION BY "nodeId", "_rb_slug"("name") ORDER BY "position") AS n FROM "ResourceNeed") x
) s WHERE s."id" = c."id";
ALTER TABLE "ResourceNeed" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "ResourceNeed_nodeId_slug_key" ON "ResourceNeed"("nodeId", "slug");

DROP FUNCTION "_rb_slug"(TEXT);

-- 4. Message handles.
ALTER TABLE "Message" ADD COLUMN "handle" TEXT;
UPDATE "Message" SET "handle" = 'm-' || SUBSTR(MD5("id"), 1, 6);
ALTER TABLE "Message" ALTER COLUMN "handle" SET NOT NULL;
CREATE UNIQUE INDEX "Message_nodeId_handle_key" ON "Message"("nodeId", "handle");
