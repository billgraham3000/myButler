# MyButler

A private personal advisor: it learns its owner's tastes, people, routines and goals, keeps a routine-based calendar, and twice a day suggests what's worth their time. Built on Azure Functions, Azure Static Web Apps and Claude.

- App: https://mybutler.califa.ai (owner only)
- Design and decisions: `docs/mybutler.md`
- Azure setup: `docs/azure.md`
- Tests: `cd api && npm install && cd .. && node tools/check-mybutler.mjs`
- Deploy: `scripts/deploy-api.sh`, `scripts/deploy-web.sh`
