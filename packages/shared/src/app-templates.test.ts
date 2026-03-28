import { describe, expect, test } from "bun:test";
import {
  getAppTemplate,
  listAppTemplates,
  maskTemplateFieldValue,
  renderAppTemplate
} from "./app-templates";
import { inspectAppTemplates, resolveAppTemplateFreshness } from "./app-template-maintenance";

describe("app template catalog", () => {
  test("ships a representative starter catalog", () => {
    const templates = listAppTemplates();
    const slugs = templates.map((template) => template.slug);

    expect(slugs.includes("postgres")).toBe(true);
    expect(slugs.includes("redis")).toBe(true);
    expect(slugs.includes("rabbitmq")).toBe(true);
    expect(slugs.includes("n8n")).toBe(true);
    expect(slugs.includes("fizzy")).toBe(true);
    expect(slugs.includes("uptime-kuma")).toBe(true);
    expect(slugs.includes("openclaw")).toBe(true);
  });

  test("ships template freshness metadata without catalog errors", () => {
    const templates = listAppTemplates();
    const issues = inspectAppTemplates(templates, new Date("2026-03-28T00:00:00.000Z"));

    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(
      templates.every(
        (template) =>
          template.maintenance.version.length > 0 &&
          template.maintenance.sourceUrl.length > 0 &&
          template.maintenance.changeNotes.length > 0
      )
    ).toBe(true);
  });

  test("derives current, review-soon, and stale template freshness states", () => {
    const template = getAppTemplate("postgres");
    if (!template) {
      throw new Error("Expected the postgres template to exist.");
    }

    expect(resolveAppTemplateFreshness(template, new Date("2026-04-10T00:00:00.000Z")).status).toBe(
      "current"
    );
    expect(resolveAppTemplateFreshness(template, new Date("2026-05-31T00:00:00.000Z")).status).toBe(
      "review-soon"
    );
    expect(resolveAppTemplateFreshness(template, new Date("2026-06-25T00:00:00.000Z")).status).toBe(
      "stale"
    );
  });

  test("renders stack-aware compose from template inputs", () => {
    const rendered = renderAppTemplate({
      slug: "postgres",
      projectName: "Team Data",
      values: {
        postgres_db: "analytics",
        postgres_user: "analytics",
        postgres_password: "secret-value",
        postgres_port: "55432"
      }
    });

    expect(rendered.projectName).toBe("team-data");
    expect(rendered.compose).toContain("name: team-data");
    expect(rendered.compose).toContain('"55432:5432"');
    expect(rendered.compose).toContain("team-data-postgres-data");
    expect(rendered.fields.find((field) => field.key === "postgres_password")?.value).toBe(
      "secret-value"
    );
  });

  test("rejects missing required template inputs", () => {
    expect(() =>
      renderAppTemplate({
        slug: "n8n",
        values: {
          n8n_domain: "n8n.example.com"
        }
      })
    ).toThrow('Template field "Encryption key" is required.');
  });

  test("renders the Fizzy starter with documented storage and mail settings", () => {
    const rendered = renderAppTemplate({
      slug: "fizzy",
      values: {
        fizzy_domain: "fizzy.example.com",
        fizzy_secret_key_base: "secret-value",
        fizzy_mailer_from_address: "fizzy@example.com",
        fizzy_smtp_address: "smtp.postmarkapp.com",
        fizzy_smtp_port: "587",
        fizzy_smtp_username: "server-token",
        fizzy_smtp_password: "smtp-secret"
      }
    });

    expect(rendered.compose).toContain("ghcr.io/basecamp/fizzy:main");
    expect(rendered.compose).toContain('BASE_URL: "https://fizzy.example.com"');
    expect(rendered.compose).toContain('SMTP_PORT: "587"');
    expect(rendered.compose).toContain("fizzy-fizzy-storage");
  });

  test("masks secrets without mutating plain values", () => {
    expect(maskTemplateFieldValue("clear-text", false)).toBe("clear-text");
    expect(maskTemplateFieldValue("secret-value", true)).toBe("••••••••");
  });

  test("escapes compose-sensitive characters in rendered values", () => {
    const rendered = renderAppTemplate({
      slug: "postgres",
      values: {
        postgres_db: "analytics",
        postgres_user: "analytics",
        postgres_password: 'pa$"word\\tail',
        postgres_port: "5432"
      }
    });

    expect(rendered.compose).toContain('POSTGRES_PASSWORD: "pa$$\\"word\\\\tail"');
    expect(rendered.compose).toContain(
      'test: ["CMD-SHELL", "pg_isready -U \\"$$POSTGRES_USER\\" -d \\"$$POSTGRES_DB\\""]'
    );
  });
});
