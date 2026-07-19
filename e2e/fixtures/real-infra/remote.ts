import type { RealInfraConfig } from "./config";
import type { RealInfraNames } from "./names";
import type { PinnedSshSession } from "./ssh";
import { shellQuote } from "./ssh";

const REMOTE_TIMEOUT_MS = 90_000;

function volumeCommand(names: RealInfraNames, command: string) {
  return [
    "set -eu",
    `docker run --rm -v ${shellQuote(`${names.volume}:/state`)} alpine:3.20 sh -c ${shellQuote(command)}`
  ].join("; ");
}

export async function assertRemoteServiceHealthy(session: PinnedSshSession, names: RealInfraNames) {
  const projectLabel = `label=com.docker.compose.project=${names.composeProject}`;
  const webLabel = "label=com.docker.compose.service=web";
  await session.run(
    [
      "set -eu",
      `container=$(docker ps -q --filter ${shellQuote(projectLabel)} --filter ${shellQuote(webLabel)})`,
      'test -n "$container"',
      'test "$(docker inspect -f {{.State.Running}} "$container")" = true',
      'docker exec "$container" wget -qO- http://127.0.0.1/ | grep -q "Welcome to nginx"'
    ].join("; "),
    REMOTE_TIMEOUT_MS
  );
}

export async function writeSentinel(session: PinnedSshSession, names: RealInfraNames) {
  await session.run(
    volumeCommand(
      names,
      `printf %s ${shellQuote(names.sentinelValue)} > /state/${names.sentinelFile}`
    ),
    REMOTE_TIMEOUT_MS
  );
}

export async function assertSentinel(session: PinnedSshSession, names: RealInfraNames) {
  await session.run(
    volumeCommand(
      names,
      `test \"$(cat /state/${names.sentinelFile})\" = ${shellQuote(names.sentinelValue)}`
    ),
    REMOTE_TIMEOUT_MS
  );
}

export async function destroySentinel(session: PinnedSshSession, names: RealInfraNames) {
  await session.run(volumeCommand(names, `rm -f /state/${names.sentinelFile}`), REMOTE_TIMEOUT_MS);
}

export async function assertSentinelMissing(session: PinnedSshSession, names: RealInfraNames) {
  await session.run(
    volumeCommand(names, `test ! -e /state/${names.sentinelFile}`),
    REMOTE_TIMEOUT_MS
  );
}

export async function cleanupOwnedRemote(
  session: PinnedSshSession,
  config: RealInfraConfig,
  names: RealInfraNames
) {
  const projectLabel = `label=com.docker.compose.project=${names.composeProject}`;
  await session.verifyMarker();
  await session.run(
    [
      "set -eu",
      `containers=$(docker ps -aq --filter ${shellQuote(projectLabel)} || true)`,
      'if [ -n "$containers" ]; then docker rm -f $containers; fi',
      `networks=$(docker network ls -q --filter ${shellQuote(projectLabel)} || true)`,
      'if [ -n "$networks" ]; then docker network rm $networks; fi',
      `if docker volume inspect ${shellQuote(names.volume)} >/dev/null 2>&1; then docker volume rm ${shellQuote(names.volume)}; fi`,
      `case ${shellQuote(config.workspaceRoot)} in /tmp/daoflow-real-infra/*) rm -rf -- ${shellQuote(config.workspaceRoot)} ;; *) exit 1 ;; esac`
    ].join("; "),
    REMOTE_TIMEOUT_MS
  );
}

export async function assertZeroOwnedRemote(
  session: PinnedSshSession,
  config: RealInfraConfig,
  names: RealInfraNames
) {
  const projectLabel = `label=com.docker.compose.project=${names.composeProject}`;
  const remaining = await session.run(
    [
      "set -u",
      `for id in $(docker ps -aq --filter ${shellQuote(projectLabel)}); do printf 'container:%s\\n' \"$id\"; done`,
      `for id in $(docker network ls -q --filter ${shellQuote(projectLabel)}); do printf 'network:%s\\n' \"$id\"; done`,
      `if docker volume inspect ${shellQuote(names.volume)} >/dev/null 2>&1; then printf 'volume:%s\\n' ${shellQuote(names.volume)}; fi`,
      `if [ -e ${shellQuote(config.workspaceRoot)} ]; then printf 'workspace:%s\\n' ${shellQuote(config.workspaceRoot)}; fi`
    ].join("; "),
    REMOTE_TIMEOUT_MS,
    true
  );
  if (remaining.trim()) {
    throw new Error(`Owned remote resources remain after cleanup:\n${remaining.trim()}`);
  }
}
