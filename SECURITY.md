# Security Policy

Chorey is a self-hosted app for a single household, not a multi-tenant
service — but it still handles real authentication (parent passwords and
passkeys) and is meant to be reachable from outside your home network in
some deployments, so vulnerabilities in it are taken seriously.

## Supported versions

There's no long-term-support branch. Chorey ships as a single rolling
`ghcr.io/gareth-c/chorey:latest` image built from `main` on every merge — the
**only supported version is the current `latest`**. If you're running an
older pulled image or a fork, please update before reporting, since the
issue may already be fixed.

## Reporting a vulnerability

**Please don't open a public GitHub issue for a security vulnerability.**

Use GitHub's private reporting instead:
[**Report a vulnerability**](https://github.com/gareth-c/chorey/security/advisories/new)
(repo → Security tab → "Report a vulnerability"). This opens a private
advisory visible only to the maintainer until a fix is ready, so it doesn't
give anyone a head start exploiting it against a deployment that hasn't
updated yet.

Include what you'd normally include in a report: affected version/commit,
steps to reproduce, and the impact you'd expect (what an attacker gains, and
what access they'd need to start).

This is a personal project, not a staffed security team — there's no SLA,
but reports are read promptly and a genuine vulnerability gets prioritized
over everything else in the backlog. You're welcome to ask for credit in the
fix's commit/release notes, or to stay anonymous.

There's no bug bounty program.

## Scope

**In scope**: anything in this repository — the Express API, the React
client, the Dockerfile/container setup, the CI/release pipeline, and the
auth/session/WebAuthn implementation.

**Out of scope**:
- Vulnerabilities in third-party dependencies with no Chorey-specific
  exploitation path — please report those upstream (though a heads-up here
  is still welcome if it's not already tracked).
- Issues that require an already-compromised Parent session or a malicious
  Parent — a Parent is a fully trusted principal by design (they can create,
  delete, and reassign every profile and every chore); the interesting
  boundary is Parent vs. Child vs. unauthenticated, not Parent vs. Parent.
- Physical access to a device already signed in, or to the host running the
  container/database file directly.
- Missing rate limiting or hardening on `docker compose`'s own defaults
  (e.g. `SESSION_SECRET=change-me-in-production`) — those are deliberately
  left for the operator to set; see the Configuration section of
  [README.md](README.md).

## Design notes for reporters

Before reporting, it may be worth skimming
[CLAUDE.md](CLAUDE.md)'s "Auth model" section and
[DESIGN.md](DESIGN.md)'s §4.1/§8 — they document the auth/session design and
known, deliberate limitations in detail, which should save you from
re-discovering something already tracked as a known tradeoff. In short:

- Only **Parent** profiles ever have credentials (password and/or WebAuthn
  passkey); **Child** profiles have none and are reached only via an
  unguessable per-child portal token.
- Sessions are opaque random tokens in an httpOnly cookie, checked against a
  server-side table (not a signed/forgeable JWT).
- `/api/auth/login` and the passkey-verify endpoint are rate-limited per
  client IP — this depends on `TRUST_PROXY` being set correctly for your
  deployment (see README), since a misconfigured proxy trust setting is what
  would actually defeat it.
- The Child Portal's embedded "Parent sign-in" picker is passkey-only (no
  password form, no credential-less auto-login) — a typed password should
  never be exposed on a screen a child has physical access to.
- The container runs as a non-root user; all SQL is parameterized; all
  request bodies are validated with `zod` at the route boundary.

None of this makes the app immune to bugs — if you find a way through any of
the above, that's exactly the kind of report this policy is for.
