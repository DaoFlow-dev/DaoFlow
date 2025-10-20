# What is DaoFlow?

> Instead of AWS Wrapper, we're building bare metal VM wrappers for you.
> We want to be the next Wordpress but for bare metal VMs to host your own applications.

DaoFlow is an open-source platform-as-a-service solution for you and your companies to grow your business with minimal setup on bare metal VMs like Hetzner/OVH/DigitalOcean, or even AWS/Azure/Google Cloud/etc.


## What problem does it solve?

- For startups/indie developers: Saving time / cost / money on infrastructure and cloud computing services (see appendix 1).
- For enterprises: Scaling up your business with minimal setup on bare metal VMs with much lower cost than cloud computing (see appendix 2).

## Goals / Roadmap

- Vercel-like deployment experience with nearly zero configuration with CLI tools for common stacks including Next.js and Hono.
- Docker/Container first approach to deployment with Docker Compose and optionally Docker Swarm.
- Support for multiple cloud providers (AWS, Azure, Google Cloud, DigitalOcean, Hetzner, etc.).
- Super quick setup and deployment, targeting less than 5 minutes.
- First-class support for CloudFlare CDN and tunnels.
- Markplace for mature stacks like Sentry, Langfuse, .etc.

## Annoncement Video

[![Watch the video](https://landing-assets.daoflow.dev/v0-landing-assets/video-cover-shots.webp)](https://www.youtube.com/watch?v=pR8PWmwXCYk)


## Status

Currently, DaoFlow is in closed alpha stage. Please subscribe to the release notifications of this GitHub repository to be notified when the project is ready for beta testing.

## Draft: Architecture

- Next.js for the backend and frontend
- Docker (Compose) for quick deployment
- First-party CLI for Vercel / Wrangler like deployments of Next.js apps
- Bun for the package management

## License

Apache 2.0

## Investor

If your company is interested in investing in DaoFlow, please reach out to [Mike Chong (WildCat_io)](https://twitter.com/wildcat_io).

## Appendix 1: Why bare metal VMs are great for startups/indie developers?

![https://landing-assets.daoflow.dev/v0-landing-assets/peter-levels-selfhost-2.webp](https://landing-assets.daoflow.dev/v0-landing-assets/peter-levels-selfhost-2.webp)

<https://x.com/levelsio/status/1980212926444446143>


## Appendix 2: Why exit cloud computing?

![https://landing-assets.daoflow.dev/v0-landing-assets/dhh-aws-wrapper.webp](https://landing-assets.daoflow.dev/v0-landing-assets/dhh-aws-wrapper.webp)

<https://x.com/dhh/status/1980245233339408596>
