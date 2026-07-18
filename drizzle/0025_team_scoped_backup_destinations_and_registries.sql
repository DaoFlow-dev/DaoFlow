DO $$
DECLARE
  team_count integer;
BEGIN
  LOCK TABLE
    backup_destinations,
    container_registries,
    backup_policies,
    volumes,
    servers,
    services,
    projects,
    teams
  IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO team_count FROM teams;

  IF team_count = 0 AND (
    EXISTS (SELECT 1 FROM backup_destinations) OR
    EXISTS (SELECT 1 FROM container_registries)
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot assign team ownership to existing backup destinations or container registries because no teams exist.',
      HINT = 'Create the real owning team first, then rerun migration 0025. Do not use a placeholder or default team.';
  END IF;

  IF team_count > 1 AND EXISTS (SELECT 1 FROM container_registries) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot safely assign team ownership to existing container registries because more than one team exists.',
      HINT = 'Run an approved data migration that maps every registry ID to its real owning team, then rerun migration 0025. Do not assign a shared default team.';
  END IF;

  IF team_count > 1 AND EXISTS (
    SELECT 1
    FROM backup_destinations AS destination
    LEFT JOIN backup_policies AS policy ON policy.destination_id = destination.id
    LEFT JOIN volumes AS volume ON volume.id = policy.volume_id
    LEFT JOIN servers AS server ON server.id = volume.server_id
    LEFT JOIN services AS service ON service.id = volume.metadata ->> 'serviceId'
    LEFT JOIN projects AS metadata_project ON metadata_project.id = volume.metadata ->> 'projectId'
    LEFT JOIN projects AS owner_project
      ON owner_project.id = COALESCE(service.project_id, metadata_project.id)
    GROUP BY destination.id
    HAVING
      count(policy.id) = 0 OR
      count(COALESCE(owner_project.team_id, server.team_id)) <> count(policy.id) OR
      count(DISTINCT COALESCE(owner_project.team_id, server.team_id)) <> 1 OR
      bool_or(
        ((volume.metadata ? 'serviceId') AND service.id IS NULL) OR
        ((volume.metadata ? 'projectId') AND metadata_project.id IS NULL) OR
        (
          service.id IS NOT NULL AND
          metadata_project.id IS NOT NULL AND
          service.project_id <> metadata_project.id
        ) OR
        (
          owner_project.team_id IS NOT NULL AND
          server.team_id IS NOT NULL AND
          owner_project.team_id <> server.team_id
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot safely assign team ownership to one or more existing backup destinations.',
      HINT = 'Each destination must be referenced only by policies whose volumes resolve to one project team. Repair unowned or cross-team policy links, then rerun migration 0025.';
  END IF;

  DROP INDEX IF EXISTS container_registries_name_idx;
  DROP INDEX IF EXISTS container_registries_host_idx;

  ALTER TABLE backup_destinations ADD COLUMN team_id varchar(32);
  ALTER TABLE container_registries ADD COLUMN team_id varchar(32);

  IF team_count = 1 THEN
    UPDATE backup_destinations
    SET team_id = (SELECT id FROM teams LIMIT 1);

    UPDATE container_registries
    SET team_id = (SELECT id FROM teams LIMIT 1);
  ELSIF team_count > 1 THEN
    UPDATE backup_destinations AS destination
    SET team_id = inferred.team_id
    FROM (
      SELECT
        policy.destination_id,
        min(COALESCE(owner_project.team_id, server.team_id)) AS team_id
      FROM backup_policies AS policy
      INNER JOIN volumes AS volume ON volume.id = policy.volume_id
      LEFT JOIN servers AS server ON server.id = volume.server_id
      LEFT JOIN services AS service ON service.id = volume.metadata ->> 'serviceId'
      LEFT JOIN projects AS metadata_project
        ON metadata_project.id = volume.metadata ->> 'projectId'
      LEFT JOIN projects AS owner_project
        ON owner_project.id = COALESCE(service.project_id, metadata_project.id)
      WHERE policy.destination_id IS NOT NULL
      GROUP BY policy.destination_id
    ) AS inferred
    WHERE destination.id = inferred.destination_id;
  END IF;

  ALTER TABLE backup_destinations ALTER COLUMN team_id SET NOT NULL;
  ALTER TABLE container_registries ALTER COLUMN team_id SET NOT NULL;

  ALTER TABLE backup_destinations
    ADD CONSTRAINT backup_destinations_team_id_teams_id_fk
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
  ALTER TABLE container_registries
    ADD CONSTRAINT container_registries_team_id_teams_id_fk
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

  CREATE INDEX backup_destinations_team_id_idx ON backup_destinations USING btree (team_id);
  CREATE UNIQUE INDEX container_registries_name_team_idx
    ON container_registries USING btree (name, team_id);
  CREATE UNIQUE INDEX container_registries_host_team_idx
    ON container_registries USING btree (registry_host, team_id);
  CREATE INDEX container_registries_team_id_idx ON container_registries USING btree (team_id);
END
$$;
