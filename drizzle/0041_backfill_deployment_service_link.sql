DO $$
BEGIN
  LOCK TABLE deployments, services IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM deployments AS deployment
    WHERE deployment.service_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM services AS service
        WHERE service.project_id = deployment.project_id
          AND service.environment_id = deployment.environment_id
          AND service.name = deployment.service_name
          AND service.source_type = deployment.source_type
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot backfill deployments.service_id because one or more deployments have no matching service.',
      HINT = 'Each deployment must match a service with the same project, environment, service name, and source type before rerunning migration 0041.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM deployments AS deployment
    WHERE deployment.service_id IS NULL
      AND (
        SELECT count(*)
        FROM services AS service
        WHERE service.project_id = deployment.project_id
          AND service.environment_id = deployment.environment_id
          AND service.name = deployment.service_name
          AND service.source_type = deployment.source_type
      ) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot backfill deployments.service_id because one or more deployments match multiple services.',
      HINT = 'Resolve duplicate service records so every deployment matches exactly one service before rerunning migration 0041.';
  END IF;

  UPDATE deployments AS deployment
  SET service_id = service.id
  FROM services AS service
  WHERE deployment.service_id IS NULL
    AND service.project_id = deployment.project_id
    AND service.environment_id = deployment.environment_id
    AND service.name = deployment.service_name
    AND service.source_type = deployment.source_type;
END
$$;
