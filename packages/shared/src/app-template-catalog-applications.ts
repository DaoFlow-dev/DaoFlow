import type { AppTemplateDefinition } from "./app-template-types";
import { fizzyTemplate } from "./templates/fizzy";
import { n8nTemplate } from "./templates/n8n";
import { openclawTemplate } from "./templates/openclaw";
import { uptimeKumaTemplate } from "./templates/uptime-kuma";

export const applicationAppTemplates = [
  n8nTemplate,
  fizzyTemplate,
  uptimeKumaTemplate,
  openclawTemplate
] as const satisfies readonly AppTemplateDefinition[];
