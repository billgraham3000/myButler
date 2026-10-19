#!/usr/bin/env bash
# Deploys the API in api/ to the function app. Needs the Azure CLI, signed in with access to resource group myButler.
set -euo pipefail
cd "$(dirname "$0")/../api"
npm install --omit=dev --no-audit --no-fund
rm -f /tmp/mybutler-api.zip
zip -qr /tmp/mybutler-api.zip host.json package.json src node_modules
az functionapp deployment source config-zip -g myButler -n func-mybutler-mbjcu1 --src /tmp/mybutler-api.zip
curl -sS https://func-mybutler-mbjcu1.azurewebsites.net/api/health; echo
