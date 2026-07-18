CREATE UNIQUE INDEX "audit_command_intent_attempt_unique"
ON "audit_entries" (("metadata"->>'attemptId'))
WHERE "metadata"->>'immutable' = 'true' AND "metadata"->>'phase' = 'intent';
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_command_outcome_attempt_unique"
ON "audit_entries" (("metadata"->>'attemptId'))
WHERE "metadata"->>'immutable' = 'true' AND "metadata"->>'phase' = 'outcome';
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_command_acceptance_attempt_unique"
ON "audit_entries" (("metadata"->>'attemptId'))
WHERE "metadata"->>'immutable' = 'true' AND "metadata"->>'phase' = 'acceptance';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_immutable_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."metadata"->>'immutable' = 'true' THEN
    RAISE EXCEPTION 'immutable audit entries cannot be updated or deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_entries_immutable_guard"
BEFORE UPDATE OR DELETE ON "audit_entries"
FOR EACH ROW
EXECUTE FUNCTION "prevent_immutable_audit_mutation"();
