# AGENTS.md

Contributor guidance for Apxeer.

## Open Source Guidelines

This is a public open source repository. All contributions must follow these rules:

- **No secrets**: Never commit API keys, tokens, passwords, or any credentials. Use environment variables or config files that are listed in `.gitignore`.
- **No local paths**: Do not hardcode user-specific or machine-specific paths (e.g. `/home/yourname/`, `C:\Users\yourname\`). Use relative paths, environment variables, or runtime-resolved paths.
- **No local dev env specifics**: Do not commit editor configs, IDE settings, or local tooling overrides that are personal to a developer's machine.
- **No personal data**: Do not include real telemetry data, real user data, or any personally identifiable information in commits, seeds, or test fixtures.

## Documentation

Architecture, design decisions, and notable implementation details are kept in `docs/`. Update the relevant file(s) in `docs/` whenever you make a change that affects architecture, data flow, API contracts, DB schema, or key design decisions. Create new files as needed — keep them focused by topic.

Also keep `README.md` up to date whenever you make changes that affect how to set up, run, or understand the project.

## Git Workflow

Commit often — after each small, self-contained, working change. Each commit should leave the codebase in a working state. Prefer many focused commits over one large commit at the end of a task.

## Pull Request Guidelines

When working on a GitHub Pull Request:

- **Keep the title and description up to date**: As work evolves, update the PR title and description to accurately reflect the current state of the changes.
- **Link the GitHub Issue**: If there is a related GitHub Issue, always include a link to it in the PR description (e.g. `Closes #123` or `Related to #123`).
