# What is DaoFlow?

> Instead of AWS Wrapper, we're building bare metal VM wrappers for you.

DaoFlow is an open-source platform-as-a-service solution for you and your companies to grow your business with minimal setup on bare metal VMs like Hetzner/OVH/DigitalOcean, or even AWS/Azure/Google Cloud/etc.


## What problem does it solve?

- For startups/indie developers: Saving time / cost / money on infrastructure and cloud computing services (see appendix 1).
- For enterprises: Scaling up your business with minimal setup on bare metal VMs with much lower cost than cloud computing (see appendix 2).

## Goals / Roadmap

- Vercel-like deployment experience with nearly zero configuration with CLI tools for common stacks including Next.js and Hono.
- Docker/Container first approach to deployment with Docker Compose and optionally Docker Swarm.
- Support for multiple cloud providers (AWS, Azure, Google Cloud, DigitalOcean, Hetzner, etc.).
- Suepr quick setup and deployment, targeting less than 5 minutes.
- Markplace for mature stacks like Sentry, Langfuse, .etc.

## Status

Currently, DaoFlow is in closed alpha stage. Please subscribe to the release notifications of this GitHub repository to be notified when the project is ready for beta testing.

## Draft: Architecture

- TanStack Start for the backend and frontend
- Docker (Compose) for quick deployment
- Bun for the package management

## License

Apache 2.0

## Appendix 1: Why bare metal VMs are great for startups/indie developers?

![https://landing-assets.daoflow.dev/v0-landing-assets/peter-levels-selfhost.webp](https://landing-assets.daoflow.dev/v0-landing-assets/peter-levels-selfhost.webp)

<https://x.com/levelsio/status/1980212926444446143>


## Appendix 2: Why exit cloud computing?

![https://landing-assets.daoflow.dev/v0-landing-assets/dhh-aws-wrapper.webp](https://landing-assets.daoflow.dev/v0-landing-assets/dhh-aws-wrapper.webp)

<https://x.com/dhh/status/1980245233339408596>
