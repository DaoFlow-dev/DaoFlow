export function webhookProjectTargetKey(projectId: string) {
  return `project:${projectId}`;
}

export function webhookServiceTargetKey(serviceId: string) {
  return `service:${serviceId}`;
}
