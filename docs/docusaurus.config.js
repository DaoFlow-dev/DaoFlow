// @ts-check
import { themes as prismThemes } from "prism-react-renderer";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "DaoFlow",
  tagline: "Open-source Agentic DevOps System — from prompts to production",
  favicon: "img/favicon.ico",

  future: {
    v4: true
  },

  url: "https://daoflow.dev",
  baseUrl: "/",

  organizationName: "daoflow",
  projectName: "daoflow",

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"]
  },

  headTags: [
    {
      tagName: "link",
      attributes: {
        rel: "preconnect",
        href: "https://fonts.googleapis.com"
      }
    },
    {
      tagName: "link",
      attributes: {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "anonymous"
      }
    },
    {
      tagName: "link",
      attributes: {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
      }
    }
  ],

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: "./sidebars.js",
          editUrl: "https://github.com/daoflow/daoflow/tree/main/docs/"
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css"
        }
      })
    ]
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: "light",
        disableSwitch: true,
        respectPrefersColorScheme: false
      },
      navbar: {
        title: "DaoFlow",
        logo: {
          alt: "DaoFlow Logo",
          src: "img/logo.svg"
        },
        items: [
          {
            type: "docSidebar",
            sidebarId: "docsSidebar",
            position: "left",
            label: "Docs"
          },
          {
            to: "/docs/api",
            label: "API",
            position: "left"
          },
          {
            to: "/docs/cli",
            label: "CLI",
            position: "left"
          },
          {
            to: "/docs/comparisons",
            label: "Comparisons",
            position: "left"
          },
          {
            to: "/docs/agents",
            label: "Agents",
            position: "left"
          },
          {
            href: "https://github.com/DaoFlow-dev/DaoFlow",
            label: "GitHub",
            position: "right"
          }
        ]
      },
      footer: {
        style: "light",
        links: [
          {
            title: "Documentation",
            items: [
              { label: "Getting Started", to: "/docs/getting-started" },
              { label: "Architecture", to: "/docs/concepts/architecture" },
              { label: "CLI Reference", to: "/docs/cli" },
              { label: "API Reference", to: "/docs/api" }
            ]
          },
          {
            title: "Product",
            items: [
              { label: "Deployments", to: "/docs/deployments" },
              { label: "Backup & Restore", to: "/docs/backups" },
              { label: "Security & RBAC", to: "/docs/security" },
              { label: "Agent Integration", to: "/docs/agents" }
            ]
          },
          {
            title: "Community",
            items: [
              {
                label: "GitHub",
                href: "https://github.com/DaoFlow-dev/DaoFlow"
              },
              { label: "Discord", href: "https://discord.gg/daoflow" }
            ]
          }
        ],
        copyright: `Copyright © ${new Date().getFullYear()} DaoFlow. Built with Docusaurus.`
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.github,
        additionalLanguages: ["bash", "json", "yaml", "docker", "toml"]
      }
    })
};

export default config;
