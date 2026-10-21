# GamFix Admin

Single-administrator console for the GamFix platform. Institutions never get an
admin panel: the administrator issues their accounts here and manages what each
account can see and do.

## Pages

- Overview: complaint volume stats and charts
- Institutions: agencies on the platform, routing scope
- Accounts: account issuance by the administrator (temporary passwords)
- Access Control: per-institution access level, categories, SLA and rate limits
- Audit Log: every administrative action
- Settings: escalation thresholds and notifications

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

All data comes from `src/lib/adminApi.ts`, which currently returns clearly
labeled mock data. Real RPC names will replace the mock implementations.
