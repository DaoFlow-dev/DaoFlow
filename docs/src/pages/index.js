import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import HomepageFeatures from "@site/src/components/HomepageFeatures";
import CodeBlock from "@theme/CodeBlock";

import Heading from "@theme/Heading";
import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx(styles.heroBanner)}>
      <div className="container">
        <div className={styles.heroContent}>
          <span className={styles.badge}>Open Source</span>
          <Heading as="h1" className={styles.heroTitle}>
            {siteConfig.title}
          </Heading>
          <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
          <p className={styles.heroDescription}>
            The hosting platform designed from day one for AI agents to deploy, inspect, diagnose,
            and rollback — with full human oversight.
          </p>
          <div className={styles.buttons}>
            <Link className={clsx("button button--lg", styles.primaryBtn)} to="/docs/">
              Get Started →
            </Link>
            <Link
              className={clsx("button button--lg", styles.secondaryBtn)}
              href="https://github.com/DaoFlow-dev/DaoFlow"
            >
              View on GitHub
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

function HomepageCode() {
  const installCode = `# Install DaoFlow (one command)
curl -fsSL https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/scripts/install.sh | sh`;

  const agentCode = `# Deploy from your AI agent
daoflow deploy --compose ./compose.yaml --server vps1 --dry-run --json
daoflow deploy --compose ./compose.yaml --server vps1 --yes --json

# Diagnose failures
daoflow doctor --json

# Rollback safely
daoflow rollback --service my-app --yes --json`;

  return (
    <section className={styles.codeSection}>
      <div className="container">
        <div className={styles.codeSectionHeader}>
          <Heading as="h2" className={styles.codeSectionTitle}>
            From prompt to production
          </Heading>
          <p className={styles.codeSectionSubtitle}>
            One install. One CLI. Your AI agent handles the rest.
          </p>
        </div>
        <div className={styles.codeBlocks}>
          <div className={styles.codeBlock}>
            <CodeBlock language="bash" title="Install">
              {installCode}
            </CodeBlock>
          </div>
          <div className={styles.codeBlock}>
            <CodeBlock language="bash" title="Deploy with your AI agent">
              {agentCode}
            </CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <Layout
      title="Documentation"
      description="DaoFlow — Open-source Agentic DevOps System. Deploy, inspect, diagnose, and rollback with AI agents."
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <HomepageCode />
      </main>
    </Layout>
  );
}
