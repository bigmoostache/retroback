-- Users, web sessions, named API keys, and who can access each plan.
-- Plans that exist before this migration are given to local@dev, their owner.

CREATE TYPE "PlanRole" AS ENUM ('owner', 'contributor');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");
CREATE UNIQUE INDEX "ApiKey_userId_name_key" ON "ApiKey"("userId", "name");
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlanMember" (
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlanRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanMember_pkey" PRIMARY KEY ("planId", "userId")
);
CREATE INDEX "PlanMember_userId_idx" ON "PlanMember"("userId");
ALTER TABLE "PlanMember" ADD CONSTRAINT "PlanMember_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanMember" ADD CONSTRAINT "PlanMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One owner per plan, at most; the engine makes sure there is always one.
CREATE UNIQUE INDEX "PlanMember_one_owner" ON "PlanMember"("planId") WHERE "role" = 'owner';

-- Existing plans belong to local@dev.
INSERT INTO "User" ("id", "email", "name")
SELECT 'user-local-dev', 'local@dev', 'Local developer'
WHERE EXISTS (SELECT 1 FROM "Plan");

INSERT INTO "PlanMember" ("planId", "userId", "role")
SELECT "id", 'user-local-dev', 'owner' FROM "Plan";
