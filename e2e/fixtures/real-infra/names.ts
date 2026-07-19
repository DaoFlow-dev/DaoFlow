export interface RealInfraNames {
  server: string;
  project: string;
  environment: string;
  service: string;
  composeProject: string;
  volume: string;
  policy: string;
  destination: string;
  s3Prefix: string;
  sentinelFile: string;
  sentinelValue: string;
}

export function realInfraNames(runToken: string): RealInfraNames {
  return {
    server: `realinfra-server-${runToken}`,
    project: `realinfra-project-${runToken}`,
    environment: `realinfra-env-${runToken}`,
    service: `realinfra-service-${runToken}`,
    composeProject: `realinfra-compose-${runToken}`,
    volume: `realinfra-volume-${runToken}`,
    policy: `realinfra-policy-${runToken}`,
    destination: `realinfra-destination-${runToken}`,
    s3Prefix: `real-infra/${runToken}`,
    sentinelFile: `.daoflow-sentinel-${runToken}`,
    sentinelValue: `sentinel-${runToken}`
  };
}
