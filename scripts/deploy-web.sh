#!/usr/bin/env bash
# Deploys the web app in web/ to the static web app. Needs the Azure CLI signed in, and Node for the deployment tool.
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN="${SWA_DEPLOY_TOKEN:-$(az staticwebapp secrets list -n swa-mybutler -g myButler --query properties.apiKey -o tsv)}"
npx --yes @azure/static-web-apps-cli deploy ./web --deployment-token "$TOKEN" --env production
