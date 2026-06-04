# Security Policy

## Supported Versions

Ewokbot is pre-1.0. Security fixes target the current `main` branch.

## Reporting a Vulnerability

Please do not open a public issue with exploit details.

Report privately through the repository owner's preferred GitHub security contact, or open a minimal issue that says you have a security report to share privately.

## Secret Handling

Never commit real credentials.

Ignored local files include:

- `.env`
- `.env.*`
- `runs/`

Use `.env.example` for placeholders only.

## Security Boundaries

Ewokbot must preserve these boundaries:

- mock mode is safe by default,
- MCP tools are allowlisted before use,
- provider writes go through typed ports,
- production merge and production deployment are human-only,
- logs and reports must not print secrets.
