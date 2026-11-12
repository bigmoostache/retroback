-- Append-only log of every operation that changes data.

CREATE TABLE "Event" (
    "seq" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "plan" TEXT,
    "input" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("seq")
);

CREATE INDEX "Event_plan_seq_idx" ON "Event"("plan", "seq");

-- The log is append only: the database itself refuses to change or delete an entry.
CREATE FUNCTION "event_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'The event log is append only: % is refused.', TG_OP;
END
$$;

CREATE TRIGGER "event_no_update_delete" BEFORE UPDATE OR DELETE ON "Event"
    FOR EACH ROW EXECUTE FUNCTION "event_append_only"();

CREATE TRIGGER "event_no_truncate" BEFORE TRUNCATE ON "Event"
    FOR EACH STATEMENT EXECUTE FUNCTION "event_append_only"();
