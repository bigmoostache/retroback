-- CreateEnum
CREATE TYPE "ObstacleStatus" AS ENUM ('open', 'fixed');

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "due" TIMESTAMP(3),
ADD COLUMN     "duration" DOUBLE PRECISION,
ALTER COLUMN "level" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "cash" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "cashUnit" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "start" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ResourceNeed" ADD COLUMN     "provides" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Obstacle" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "fix" TEXT NOT NULL DEFAULT '',
    "status" "ObstacleStatus" NOT NULL DEFAULT 'open',

    CONSTRAINT "Obstacle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Obstacle_nodeId_position_idx" ON "Obstacle"("nodeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Obstacle_nodeId_slug_key" ON "Obstacle"("nodeId", "slug");

-- AddForeignKey
ALTER TABLE "Obstacle" ADD CONSTRAINT "Obstacle_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
