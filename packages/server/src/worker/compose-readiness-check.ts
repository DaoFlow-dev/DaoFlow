import { type ComposeReadinessProbeSnapshot } from "../compose-readiness";
import { type ComposeContainerStatus } from "./compose-health";
import { execStreaming, type OnLog } from "./docker-executor";
import {
  resolveLocalInternalNetworkTargets,
  resolveRemoteInternalNetworkTargets
} from "./compose-readiness-internal-targets";
import {
  isPublishedPortProbe,
  runLocalInternalNetworkReadinessCheck,
  runLocalPublishedPortReadinessCheck,
  runRemoteInternalNetworkReadinessCheck,
  runRemotePublishedPortReadinessCheck,
  type ComposeReadinessAttempt
} from "./compose-readiness-probe-runner";
import { execRemote, type SSHTarget } from "./ssh-connection";

type LocalExecRunner = typeof execStreaming;

export type { ComposeReadinessAttempt } from "./compose-readiness-probe-runner";
export type { ComposeInternalNetworkTarget } from "./compose-readiness-internal-targets";
export {
  runLocalInternalNetworkReadinessCheck,
  runRemoteInternalNetworkReadinessCheck
} from "./compose-readiness-probe-runner";

export async function runLocalComposeReadinessCheck(
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[],
  fetchImpl: typeof fetch = fetch,
  execRunner: LocalExecRunner = execStreaming
): Promise<ComposeReadinessAttempt> {
  if (isPublishedPortProbe(probe)) {
    return runLocalPublishedPortReadinessCheck(probe, fetchImpl);
  }

  const internalTargets = await resolveLocalInternalNetworkTargets(probe, statuses, execRunner);
  return runLocalInternalNetworkReadinessCheck(probe, internalTargets, fetchImpl);
}

export async function runRemoteComposeReadinessCheck(
  target: SSHTarget,
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[],
  onLog: OnLog,
  exec: typeof execRemote = execRemote
): Promise<ComposeReadinessAttempt> {
  if (isPublishedPortProbe(probe)) {
    return runRemotePublishedPortReadinessCheck(target, probe, onLog, exec);
  }

  const internalTargets = await resolveRemoteInternalNetworkTargets(
    target,
    probe,
    statuses,
    onLog,
    exec
  );
  return runRemoteInternalNetworkReadinessCheck(target, probe, internalTargets, onLog, exec);
}
