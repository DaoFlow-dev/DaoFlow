DO $$
DECLARE
  team_count integer;
BEGIN
  LOCK TABLE git_providers, git_installations, projects, teams IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO team_count FROM teams;

  IF team_count = 0 AND (
    EXISTS (SELECT 1 FROM git_providers) OR EXISTS (SELECT 1 FROM git_installations)
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot assign team ownership to existing Git providers or installations because no teams exist.',
      HINT = 'Create the real owning team first, then rerun migration 0027. Do not use a placeholder or default team.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM git_installations
    WHERE permissions ~ '"access_token"[[:space:]]*:'
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot upgrade while a GitLab installation still stores a legacy plaintext access token.',
      HINT = 'Clear the legacy installation permissions, rerun migration 0027, then reconnect that GitLab account so DaoFlow stores an encrypted token.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM git_installations installation
    INNER JOIN git_providers provider ON provider.id = installation.provider_id
    WHERE provider.type = 'gitlab'
      AND (
        installation.permissions IS NULL
        OR installation.permissions !~ '"accessTokenEncrypted"[[:space:]]*:'
        OR installation.permissions !~ '"refreshTokenEncrypted"[[:space:]]*:'
        OR installation.permissions !~ '"expiresAt"[[:space:]]*:'
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot upgrade while a GitLab installation lacks refreshable encrypted OAuth credentials.',
      HINT = 'Remove or clear the legacy GitLab installation, rerun migration 0027, then reconnect it through the OAuth setup flow.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM projects AS project
    LEFT JOIN git_providers AS provider ON provider.id = project.git_provider_id
    LEFT JOIN git_installations AS installation ON installation.id = project.git_installation_id
    WHERE
      (project.git_provider_id IS NOT NULL AND provider.id IS NULL)
      OR (project.git_installation_id IS NOT NULL AND installation.id IS NULL)
      OR (
        project.git_installation_id IS NOT NULL AND
        (project.git_provider_id IS NULL OR installation.provider_id <> project.git_provider_id)
      )
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot safely assign Git ownership because one or more project bindings are incomplete or inconsistent.',
      HINT = 'Each project Git installation must exist and match its project Git provider before rerunning migration 0027.';
  END IF;

  IF team_count > 1 AND EXISTS (
    SELECT 1
    FROM git_providers AS provider
    LEFT JOIN projects AS project ON project.git_provider_id = provider.id
    GROUP BY provider.id
    HAVING count(project.id) = 0 OR count(DISTINCT project.team_id) <> 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot safely assign team ownership to one or more existing Git providers.',
      HINT = 'Every provider must be referenced by projects from exactly one real team. Repair unused or cross-team provider bindings, then rerun migration 0027.';
  END IF;

  IF team_count > 1 AND EXISTS (
    SELECT 1
    FROM git_installations AS installation
    LEFT JOIN projects AS project
      ON project.git_installation_id = installation.id
      AND project.git_provider_id = installation.provider_id
    GROUP BY installation.id
    HAVING count(project.id) = 0 OR count(DISTINCT project.team_id) <> 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot safely assign team ownership to one or more existing Git installations.',
      HINT = 'Every installation must be referenced by projects from exactly one real team. Repair unused or cross-team installation bindings, then rerun migration 0027.';
  END IF;

  IF team_count = 1 THEN
    UPDATE git_providers SET team_id = (SELECT id FROM teams LIMIT 1);
    UPDATE git_installations SET team_id = (SELECT id FROM teams LIMIT 1);
  ELSIF team_count > 1 THEN
    UPDATE git_providers AS provider
    SET team_id = inferred.team_id
    FROM (
      SELECT git_provider_id AS provider_id, min(team_id) AS team_id
      FROM projects
      WHERE git_provider_id IS NOT NULL
      GROUP BY git_provider_id
    ) AS inferred
    WHERE provider.id = inferred.provider_id;

    UPDATE git_installations AS installation
    SET team_id = provider.team_id
    FROM git_providers AS provider
    WHERE installation.provider_id = provider.id;
  END IF;
END
$$;
