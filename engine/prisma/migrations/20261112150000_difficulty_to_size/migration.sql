-- Difficulty is renamed size: how big a node is, from 0 to 100.
ALTER TABLE "Node" RENAME COLUMN "difficulty" TO "size";
