# MyButler on Azure

Everything lives in the resource group **myButler** (subscription "Azure subscription 1", region West Europe). It was set up on 2026-10-19, when MyButler moved out of 4Muses.

## Resources

| Resource | Name | What it does |
|---|---|---|
| Static web app (Free) | `swa-mybutler` | The page, at https://mybutler.califa.ai (custom domain since 2026-10-21) and https://salmon-grass-0ae222003.2.azurestaticapps.net |
| Function app (Flex Consumption, Node 22) | `func-mybutler-mbjcu1` | The API at https://func-mybutler-mbjcu1.azurewebsites.net/api, and the hourly timer |
| Storage account | `stmbjcu1butler` | Containers `mybutler` (the owner's data), `auth` (sessions, sign-in links, passkeys), `state` (timer flags, request counters), plus the function app's own |
| Key vault (RBAC) | `kv-mybutler-mbjcu1` | Secrets |
| Communication Services + Email | `acs-mybutler`, `email-mybutler` | The digest and sign-in emails, from an Azure-managed sender address (`DoNotReply@…azurecomm.net`) |
| Application Insights + Log Analytics | `appi-mybutler`, `log-mybutler` | Logs |

The function app signs in to storage and the key vault with its own managed identity (Storage Blob Data Owner; Key Vault Secrets User). No storage keys are used in code.

## Storage history

- **Undo:** blob versioning, plus blob and container soft delete for 30 days, so a wrong change can be undone in the portal (open the blob → Versions).
- **Cleanup:** lifecycle rules delete old versions after 30 days, and after 1 day for the function app's own containers (`app-package-…`, `azure-webjobs-…`).

## Secrets in the key vault

| Secret | Used for |
|---|---|
| `ANTHROPIC-API-KEY` | Claude. **The owner adds it** (the same key as in the 4Muses vault). Until then the app shows "Claude: off". |
| `ACS-CONNECTION-STRING` | Sending email. Set up at creation. |
| `TICKETMASTER-API-KEY` | Events. Optional; the owner adds it later. |

To add one, open the key vault in the Azure portal, choose Secrets, then Generate/Import. Never paste a key into a chat. Then restart the function app:

```
az functionapp restart -g myButler -n func-mybutler-mbjcu1
```

## App settings on the function app

| Setting | Value |
|---|---|
| `ANTHROPIC_API_KEY`, `ACS_CONNECTION_STRING`, `TICKETMASTER_API_KEY` | Key Vault references |
| `STORAGE_ACCOUNT` | `stmbjcu1butler` |
| `OWNER_EMAIL` | The only address that can get a sign-in link (the same as in 4Muses) |
| `OWNER_ID` | The owner's data folder in `mybutler/` (the 4Muses player id, kept so the data moved unchanged) |
| `BUTLER_MODEL` | The Claude model (a strong one); optional `FALLBACK_MODEL` |
| `MAIL_FROM` | The Azure-managed sender address |
| `SITE_URL` | The web app's address, used in emailed links and for passkeys (optional `PASSKEY_RP_ID`, `PASSKEY_ORIGINS`) |

CORS on the function app allows only the web app's two addresses: https://mybutler.califa.ai and https://salmon-grass-0ae222003.2.azurestaticapps.net. `SITE_URL` is https://mybutler.califa.ai.

## Deploying

```
scripts/deploy-api.sh
scripts/deploy-web.sh
```

The page finds the API through `web/config.js`; its security policy (`web/staticwebapp.config.json`) allows connections only to that API.

## Access

- The Claude agent's service principal (`modular2-claude-agent`) is Owner on the group, and Key Vault Secrets Officer on the vault.
- The owner's account is Key Vault Secrets Officer on the vault.

## Custom domain

`mybutler.califa.ai` was added on 2026-10-21. The function app's CORS and `SITE_URL` were updated the same day, after sign-in failed with "No connection": the browser blocks API calls from an address CORS doesn't list, and the page reports that as no connection. For another domain:


1. In the portal, open `swa-mybutler`, then Custom domains, then Add, and create the CNAME the portal shows at the registrar.
2. Then update:
   - `SITE_URL` on the function app;
   - CORS on the function app;
   - `web/config.js` only if the API moves.
3. Passkeys belong to the site's address, so after a domain change add Face ID again in Settings.
