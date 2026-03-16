// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'DaoFlow',
  tagline: 'Agentic DevOps — from one prompt to production',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://daoflow.dev',
  baseUrl: '/',

  organizationName: 'daoflow',
  projectName: 'daoflow',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/daoflow/daoflow/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'light',
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'DaoFlow',
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            to: '/docs/api',
            label: 'API',
            position: 'left',
          },
          {
            to: '/docs/cli',
            label: 'CLI',
            position: 'left',
          },
          {
            href: 'https://github.com/daoflow/daoflow',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'light',
        links: [
          {
            title: 'Documentation',
            items: [
              { label: 'Getting Started', to: '/docs/getting-started' },
              { label: 'Architecture', to: '/docs/architecture' },
              { label: 'CLI Reference', to: '/docs/cli' },
              { label: 'API Reference', to: '/docs/api' },
            ],
          },
          {
            title: 'Product',
            items: [
              { label: 'Deployment Guide', to: '/docs/deployments' },
              { label: 'Backup & Restore', to: '/docs/backups' },
              { label: 'Security & RBAC', to: '/docs/security' },
            ],
          },
          {
            title: 'Community',
            items: [
              { label: 'GitHub', href: 'https://github.com/daoflow/daoflow' },
              { label: 'Discord', href: 'https://discord.gg/daoflow' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} DaoFlow. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'json', 'yaml', 'docker', 'toml'],
      },
    }),
};

export default config;
