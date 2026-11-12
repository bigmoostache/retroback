-- Requirements provided by nodes replace dependencies.
-- Each dependency (node depends on former) becomes a requirement of the node,
-- worded as the former node's title and provided by it. Nothing is lost.

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "difficulty" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "RequirementProvider" (
    "requirementId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,

    CONSTRAINT "RequirementProvider_pkey" PRIMARY KEY ("requirementId","nodeId")
);

-- CreateIndex
CREATE INDEX "RequirementProvider_nodeId_idx" ON "RequirementProvider"("nodeId");

-- AddForeignKey
ALTER TABLE "RequirementProvider" ADD CONSTRAINT "RequirementProvider_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementProvider" ADD CONSTRAINT "RequirementProvider_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Convert each dependency into a requirement provided by the former node.
CREATE TEMP TABLE "_converted" AS
SELECT
    gen_random_uuid()::text AS "requirementId",
    d."nodeId",
    d."dependsOnId",
    former."title",
    COALESCE((SELECT MAX(r."position") FROM "Requirement" r WHERE r."nodeId" = d."nodeId"), 0)
        + ROW_NUMBER() OVER (PARTITION BY d."nodeId" ORDER BY former."seq") AS "position"
FROM "Dependency" d
JOIN "Node" former ON former."id" = d."dependsOnId";

INSERT INTO "Requirement" ("id", "nodeId", "position", "text", "met")
SELECT "requirementId", "nodeId", "position", "title", false FROM "_converted";

INSERT INTO "RequirementProvider" ("requirementId", "nodeId")
SELECT "requirementId", "dependsOnId" FROM "_converted";

DROP TABLE "_converted";

-- DropForeignKey
ALTER TABLE "Dependency" DROP CONSTRAINT "Dependency_dependsOnId_fkey";

-- DropForeignKey
ALTER TABLE "Dependency" DROP CONSTRAINT "Dependency_nodeId_fkey";

-- DropTable
DROP TABLE "Dependency";
