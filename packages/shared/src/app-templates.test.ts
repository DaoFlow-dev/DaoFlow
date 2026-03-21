import { describe, expect, test } from "bun:test";
import { listAppTemplates, maskTemplateFieldValue, renderAppTemplate } from "./app-templates";

describe("app template catalog", () => {
  test("ships a representative starter catalog", () => {
    const templates = listAppTemplates();
    const slugs = templates.map((template) => template.slug);

    expect(slugs.includes("postgres")).toBe(true);
    expect(slugs.includes("redis")).toBe(true);
    expect(slugs.includes("rabbitmq")).toBe(true);
    expect(slugs.includes("n8n")).toBe(true);
    expect(slugs.includes("uptime-kuma")).toBe(true);
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
