import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "k6 Enterprise Framework",
  tagline: "Two-layer architecture for enterprise load testing with Grafana k6",
  favicon: "img/favicon.ico",

  url: "https://k6-framework.example.com",
  baseUrl: "/",

  organizationName: "your-org",
  projectName: "k6-enterprise-framework",

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en", "es"],
    localeConfigs: {
      en: { label: "English", direction: "ltr", htmlLang: "en-US" },
      es: { label: "Español", direction: "ltr", htmlLang: "es-ES" },
    },
  },

  markdown: {
    format: "md",
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "docs",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/social-card.png",
    navbar: {
      title: "k6 Enterprise Framework",
      logo: {
        alt: "k6 Framework Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "frameworkSidebar",
          position: "left",
          label: "Framework",
        },
        {
          type: "docSidebar",
          sidebarId: "clientsSidebar",
          position: "left",
          label: "Clients",
        },
        {
          type: "docSidebar",
          sidebarId: "k6ReportSidebar",
          position: "left",
          label: "k6-report",
        },
        {
          type: "localeDropdown",
          position: "right",
        },
        {
          href: "https://github.com/your-org/k6-enterprise-framework",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Documentation",
          items: [
            { label: "Getting Started", to: "/docs/intro" },
            { label: "Feature Catalog", to: "/docs/framework/feature-catalog" },
            { label: "Patterns Guide", to: "/docs/framework/patterns/patterns-guide" },
          ],
        },
        {
          title: "Clients",
          items: [
            { label: "Reference Client", to: "/docs/clients/reference/" },
            { label: "Examples", to: "/docs/clients/examples/" },
          ],
        },
        {
          title: "k6-report",
          items: [
            { label: "Overview", to: "/docs/k6-report" },
            { label: "CLI Reference", to: "/docs/k6-report/cli-reference" },
            { label: "API Reference", to: "/docs/k6-report/api-reference" },
          ],
        },
        {
          title: "Resources",
          items: [
            { label: "Grafana k6", href: "https://k6.io" },
            { label: "k6 Documentation", href: "https://grafana.com/docs/k6/latest/" },
            { label: "GitHub", href: "https://github.com/your-org/k6-enterprise-framework" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} k6 Enterprise Framework.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "yaml", "typescript"],
    },
    colorMode: {
      defaultMode: "light",
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
