import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";

import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/intro">
            Get Started
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/framework/feature-catalog"
            style={{ marginLeft: "1rem" }}
          >
            Feature Catalog
          </Link>
        </div>
      </div>
    </header>
  );
}

type FeatureItem = {
  title: string;
  description: string;
  link: string;
  emoji: string;
};

const features: FeatureItem[] = [
  {
    title: "192+ Features",
    description:
      "Load profiles, helpers, patterns, metrics, reporting, observability, security, CI/CD, and AI agents.",
    link: "/docs/framework/feature-catalog",
    emoji: "\u{1F680}",
  },
  {
    title: "Two-Layer Architecture",
    description: "Reusable generic core (src/) with isolated per-client product layers (clients/).",
    link: "/docs/intro",
    emoji: "\u{1F3D7}",
  },
  {
    title: "125+ Metrics",
    description:
      "HTTP, checks, groups, custom metrics, Web Vitals, SLO evaluation, and APDEX scoring.",
    link: "/docs/framework/metrics/metrics-engine",
    emoji: "\u{1F4CA}",
  },
  {
    title: "Interactive Reports",
    description:
      "Self-contained HTML reports with Chart.js, PDF export, LLM analysis, and trend comparison.",
    link: "/docs/framework/reporting/",
    emoji: "\u{1F4CB}",
  },
  {
    title: "Multi-Client Isolation",
    description: "Each client has independent config, data, scenarios, and documentation.",
    link: "/docs/clients/reference/",
    emoji: "\u{1F465}",
  },
  {
    title: "AI-Powered",
    description:
      "4 AI agents (Planner, Builder, Analyst, Reporter) with anomaly detection and knowledge base.",
    link: "/docs/framework/ai/ai-config",
    emoji: "\u{1F916}",
  },
  {
    title: "k6-report",
    description:
      "Standalone reporting toolkit: HTML dashboards, CSV, Markdown, Jira/GitHub tickets, capacity & trend analysis.",
    link: "/docs/k6-report",
    emoji: "\u{1F4C8}",
  },
];

function Feature({ title, description, link, emoji }: FeatureItem) {
  return (
    <div className={clsx("col col--4")}>
      <Link to={link} style={{ textDecoration: "none", color: "inherit" }}>
        <div className="feature-card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>{emoji}</div>
          <Heading as="h3">{title}</Heading>
          <p>{description}</p>
        </div>
      </Link>
    </div>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HomepageHeader />
      <main>
        <section style={{ padding: "3rem 0" }}>
          <div className="container">
            <div className="row">
              {features.map((props, idx) => (
                <Feature key={idx} {...props} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
