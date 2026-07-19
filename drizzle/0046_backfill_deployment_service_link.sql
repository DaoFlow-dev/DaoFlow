DO $$
BEGIN
  LOCK TABLE deployments, services IN SHARE ROW EXCLUSIVE MODE;

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
          AND service.created_at <= deployment.created_at
      ) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot backfill deployments.service_id because one or more deployments match multiple historical services.',
      HINT = 'Resolve duplicate historical service records before rerunning the deployment service-link migration.';
  END IF;

  WITH unique_historical_matches AS (
    SELECT
      deployment.id AS deployment_id,
      min(service.id) AS service_id
    FROM deployments AS deployment
    INNER JOIN services AS service
      ON service.project_id = deployment.project_id
      AND service.environment_id = deployment.environment_id
      AND service.name = deployment.service_name
      AND service.source_type = deployment.source_type
      AND service.created_at <= deployment.created_at
    WHERE deployment.service_id IS NULL
    GROUP BY deployment.id
    HAVING count(*) = 1
  )
  UPDATE deployments AS deployment
  SET service_id = match.service_id
  FROM unique_historical_matches AS match
  WHERE deployment.id = match.deployment_id;

  -- Historical deployments may outlive, predate, or be renamed away from their
  -- original service. Preserve those rows with a deterministic non-live identity
  -- instead of attaching them to a later same-name replacement service.
  UPDATE deployments
  SET service_id = 'legacy_' || substring(md5(id) FROM 1 FOR 25)
  WHERE service_id IS NULL;
END
$$;
