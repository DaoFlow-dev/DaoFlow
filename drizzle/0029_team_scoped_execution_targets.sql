DO $$
BEGIN
  LOCK TABLE services, environments, deployments, projects, servers IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM services service
    LEFT JOIN projects project ON project.id = service.project_id
    LEFT JOIN environments environment ON environment.id = service.environment_id
    LEFT JOIN servers server ON server.id = service.target_server_id
    WHERE project.id IS NULL
      OR environment.id IS NULL
      OR environment.project_id IS DISTINCT FROM service.project_id
      OR (
        service.target_server_id IS NOT NULL
        AND (server.id IS NULL OR server.team_id IS NULL OR server.team_id IS DISTINCT FROM project.team_id)
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce execution ownership because one or more services have invalid project, environment, or server bindings.',
      HINT = 'Repair each service so its environment belongs to its project and its target server belongs to the project team, then rerun migration 0029.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM environments environment
    LEFT JOIN projects project ON project.id = environment.project_id
    LEFT JOIN servers server
      ON server.id = NULLIF(BTRIM(environment.config->>'targetServerId'), '')
    WHERE project.id IS NULL
      OR (
        NULLIF(BTRIM(environment.config->>'targetServerId'), '') IS NOT NULL
        AND (server.id IS NULL OR server.team_id IS NULL OR server.team_id IS DISTINCT FROM project.team_id)
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce execution ownership because one or more environments target a missing or cross-team server.',
      HINT = 'Clear or repair every environment targetServerId so it belongs to the project team, then rerun migration 0029.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM deployments deployment
    LEFT JOIN projects project ON project.id = deployment.project_id
    LEFT JOIN environments environment ON environment.id = deployment.environment_id
    LEFT JOIN servers server ON server.id = deployment.target_server_id
    WHERE project.id IS NULL
      OR environment.id IS NULL
      OR environment.project_id IS DISTINCT FROM deployment.project_id
      OR server.id IS NULL
      OR server.team_id IS NULL
      OR server.team_id IS DISTINCT FROM project.team_id
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce execution ownership because one or more deployments have invalid project, environment, or server bindings.',
      HINT = 'Repair or archive invalid deployment records, then rerun migration 0029.';
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_service_execution_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  project_team_id varchar(32);
  environment_project_id varchar(32);
  server_team_id varchar(32);
BEGIN
  SELECT "team_id" INTO project_team_id
  FROM "projects"
  WHERE "id" = NEW."project_id";

  SELECT "project_id" INTO environment_project_id
  FROM "environments"
  WHERE "id" = NEW."environment_id";

  IF project_team_id IS NULL OR environment_project_id IS DISTINCT FROM NEW."project_id" THEN
    RAISE EXCEPTION 'service environment must belong to the selected project'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."target_server_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "team_id" INTO server_team_id
  FROM "servers"
  WHERE "id" = NEW."target_server_id";

  IF server_team_id IS NULL OR server_team_id IS DISTINCT FROM project_team_id THEN
    RAISE EXCEPTION 'service target server must belong to the project team'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "services_execution_scope_guard"
BEFORE INSERT OR UPDATE OF "project_id", "environment_id", "target_server_id" ON "services"
FOR EACH ROW
EXECUTE FUNCTION "enforce_service_execution_scope"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_environment_execution_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  project_team_id varchar(32);
  target_server_id varchar(32);
  server_team_id varchar(32);
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "services" service
    WHERE service."environment_id" = NEW."id"
      AND service."project_id" IS DISTINCT FROM NEW."project_id"
  ) OR EXISTS (
    SELECT 1
    FROM "deployments" deployment
    WHERE deployment."environment_id" = NEW."id"
      AND deployment."project_id" IS DISTINCT FROM NEW."project_id"
  ) THEN
    RAISE EXCEPTION 'environment project cannot change while services or deployments reference it'
      USING ERRCODE = '23514';
  END IF;

  target_server_id := NULLIF(BTRIM(NEW."config"->>'targetServerId'), '');
  IF target_server_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "team_id" INTO project_team_id
  FROM "projects"
  WHERE "id" = NEW."project_id";

  SELECT "team_id" INTO server_team_id
  FROM "servers"
  WHERE "id" = target_server_id;

  IF project_team_id IS NULL OR server_team_id IS NULL OR server_team_id IS DISTINCT FROM project_team_id THEN
    RAISE EXCEPTION 'environment target server must belong to the project team'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "environments_execution_scope_guard"
BEFORE INSERT OR UPDATE OF "project_id", "config" ON "environments"
FOR EACH ROW
EXECUTE FUNCTION "enforce_environment_execution_scope"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_deployment_execution_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  project_team_id varchar(32);
  environment_project_id varchar(32);
  server_team_id varchar(32);
BEGIN
  SELECT "team_id" INTO project_team_id
  FROM "projects"
  WHERE "id" = NEW."project_id";

  SELECT "project_id" INTO environment_project_id
  FROM "environments"
  WHERE "id" = NEW."environment_id";

  SELECT "team_id" INTO server_team_id
  FROM "servers"
  WHERE "id" = NEW."target_server_id";

  IF project_team_id IS NULL OR environment_project_id IS DISTINCT FROM NEW."project_id" THEN
    RAISE EXCEPTION 'deployment environment must belong to the selected project'
      USING ERRCODE = '23514';
  END IF;

  IF server_team_id IS NULL OR server_team_id IS DISTINCT FROM project_team_id THEN
    RAISE EXCEPTION 'deployment target server must belong to the project team'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "deployments_execution_scope_guard"
BEFORE INSERT OR UPDATE OF "project_id", "environment_id", "target_server_id" ON "deployments"
FOR EACH ROW
EXECUTE FUNCTION "enforce_deployment_execution_scope"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_scoped_server_team_reassignment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."team_id" IS NOT DISTINCT FROM OLD."team_id" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "services" service
    INNER JOIN "projects" project ON project."id" = service."project_id"
    WHERE service."target_server_id" = OLD."id"
      AND project."team_id" IS DISTINCT FROM NEW."team_id"
  ) OR EXISTS (
    SELECT 1
    FROM "deployments" deployment
    INNER JOIN "projects" project ON project."id" = deployment."project_id"
    WHERE deployment."target_server_id" = OLD."id"
      AND project."team_id" IS DISTINCT FROM NEW."team_id"
  ) OR EXISTS (
    SELECT 1
    FROM "environments" environment
    INNER JOIN "projects" project ON project."id" = environment."project_id"
    WHERE NULLIF(BTRIM(environment."config"->>'targetServerId'), '') = OLD."id"
      AND project."team_id" IS DISTINCT FROM NEW."team_id"
  ) THEN
    RAISE EXCEPTION 'server team cannot change while scoped execution targets reference it'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "servers_team_reassignment_guard"
BEFORE UPDATE OF "team_id" ON "servers"
FOR EACH ROW
EXECUTE FUNCTION "prevent_scoped_server_team_reassignment"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_scoped_project_team_reassignment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."team_id" IS NOT DISTINCT FROM OLD."team_id" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "services" service
    WHERE service."project_id" = OLD."id"
      AND service."target_server_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "servers" server
        WHERE server."id" = service."target_server_id"
          AND server."team_id" = NEW."team_id"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "deployments" deployment
    WHERE deployment."project_id" = OLD."id"
      AND NOT EXISTS (
        SELECT 1
        FROM "servers" server
        WHERE server."id" = deployment."target_server_id"
          AND server."team_id" = NEW."team_id"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "environments" environment
    WHERE environment."project_id" = OLD."id"
      AND NULLIF(BTRIM(environment."config"->>'targetServerId'), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "servers" server
        WHERE server."id" = NULLIF(BTRIM(environment."config"->>'targetServerId'), '')
          AND server."team_id" = NEW."team_id"
      )
  ) THEN
    RAISE EXCEPTION 'project team cannot change while scoped execution targets reference another team'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "projects_team_reassignment_guard"
BEFORE UPDATE OF "team_id" ON "projects"
FOR EACH ROW
EXECUTE FUNCTION "prevent_scoped_project_team_reassignment"();
