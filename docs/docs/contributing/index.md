---
sidebar_position: 1
---

# Contributing

DaoFlow is open source and welcomes contributions. This section covers how to set up your development environment, understand the architecture, write tests, and follow code conventions.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork
3. Follow the [Development Setup](./development-setup) guide
4. Create a feature branch
5. Make your changes with tests
6. Submit a pull request

## Guides

| Guide                                      | Description                   |
| ------------------------------------------ | ----------------------------- |
| [Development Setup](./development-setup)   | Local environment setup       |
| [Architecture Guide](./architecture-guide) | How the codebase is organized |
| [Testing](./testing)                       | Writing and running tests     |
| [Code Style](./code-style)                 | Conventions and formatting    |

## Contribution Principles

From the [AGENTS.md](https://github.com/DaoFlow-dev/DaoFlow/blob/main/AGENTS.md):

- Prefer smaller trusted primitives over large magical abstractions
- Prefer durable records over ephemeral process state
- Prefer explicit permissions over convenience shortcuts
- Prefer structured events over parsing raw log strings later
- Prefer one excellent deployment path over many weak ones

## Decision Rule

If a feature increases system complexity, it must clearly improve at least one of:

- Deployment reliability
- Operator clarity
- Backup safety
- Agent safety
- Auditability

If it does not, defer it.
