import type { RealInfraNames } from "./names";

export function validCompose(names: RealInfraNames) {
  return `name: ${names.composeProject}
services:
  web:
    image: nginx:1.27-alpine
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1/ >/dev/null"]
      interval: 5s
      timeout: 3s
      retries: 12
    volumes:
      - state:/usr/share/nginx/html/state
  state:
    image: alpine:3.20
    command: ["sh", "-c", "while true; do sleep 3600; done"]
    volumes:
      - state:/state
volumes:
  state:
    name: ${names.volume}
`;
}

export function invalidCompose(names: RealInfraNames) {
  return validCompose(names).replace(
    "nginx:1.27-alpine",
    `daoflow-real-infra-missing-${names.composeProject}:missing`
  );
}
