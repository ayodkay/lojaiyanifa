#!/usr/bin/env bash
# Creates Product documents in Prismic through the Migration API.
# New documents land as drafts in Prismic's "Migration Releases" tab; publish them from there.
#
# Usage (from the project root):
#   bash scripts/prismic/add-product.sh
#
# Reads PRISMIC_REPO, PRISMIC_WRITE_TOKEN and PRISMIC_LOCALE from .env.local
# (see .env.example). Never hardcode the tokens in this file.
#
# Encoding note (2026-10-31): the JSON body is written to a temp file and sent
# with --data-binary @file. The first version passed it as a command-line
# argument; on Windows, native curl.exe receives arguments re-encoded in the
# legacy code page, so accented characters (á, ç, ô...) reached Prismic as
# invalid UTF-8 and were stored as U+FFFD. scripts/prismic/fix-product-names.mjs
# repaired the affected documents.

set -uo pipefail

ENV_FILE="${ENV_FILE:-.env.local}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

REPO="${PRISMIC_REPO:?Set PRISMIC_REPO to your repository ID (in .env.local)}"
TOKEN="${PRISMIC_WRITE_TOKEN:?Set PRISMIC_WRITE_TOKEN in .env.local (Settings > API & Security > Write APIs)}"
LOCALE="${PRISMIC_LOCALE:-en-us}"
TYPE="${PRISMIC_TYPE:-products}"   # API ID of the Product type
API_URL="https://migration.prismic.io/documents"

# uid | product name | short description (optional)
PRODUCTS=(
  "conjunto-masculino|Conjunto masculino|Male ritual clothing"
  "conjunto-feminino|Conjunto feminino|"
  "pano-da-costa|Pano da costa|"
  "pano-de-cabeca|Pano de cabeça|"
  "alaka|Alaká|"
  "ekete|Ekete|Fila"
  "opon-ifa|Opon Ifá|Divination tray"
  "ikin-ifa|Ikin Ifá|Sacred palm nuts for divination"
  "buzios|Búzios|Cowrie shells (Dilogun)"
  "opele|Opele|Divination chain"
  "ifa-divination-mat|Ifá divination mat|"
  "iroke-ifa|Iroke Ifá|Divination tapper"
  "agogo-bell|Agogô bell|"
  "adjas|Adjás|Ritual bells"
  "banho-de-ori|Banho de ori|"
  "turari|Turari|"
  "ose-dudu|Ose dudu|African black soap"
  "iyerosun-powder|Iyerosun powder|Divination powder"
  "ajere-ifa|Ajere Ifá|"
  "ataare|Ataaré|Alligator pepper"
  "aridan|Aridan|African nut used in rituals"
  "obi|Obi|Kola nut"
  "obi-abata|Obi abata|Divination kola"
  "orogbo|Orogbo|Bitter kola"
  "bejerekun-seed|Bejerekun seed|"
  "alibe-seed|Alibé seed|"
  "ose-dudu-ingredients|Ose dudu ingredients|African soap base"
  "pimenta-da-costa|Pimenta da costa|"
)

response_file="$(mktemp)"
body_file="$(mktemp)"
trap 'rm -f "$response_file" "$body_file"' EXIT
created=0
failed=0

for row in "${PRODUCTS[@]}"; do
  IFS='|' read -r uid name desc <<< "$row"

  data="$(printf '"product_name":"%s"' "$name")"
  if [[ -n "$desc" ]]; then
    data+="$(printf ',"short_description":[{"type":"paragraph","text":"%s","spans":[]}]' "$desc")"
  fi
  body="$(printf '{"title":"%s","type":"%s","uid":"%s","lang":"%s","data":{%s}}' \
    "$name" "$TYPE" "$uid" "$LOCALE" "$data")"
  # Write the bytes to a file so they reach curl untouched (see encoding note above).
  printf '%s' "$body" > "$body_file"

  status="$(curl -sS --max-time 30 -o "$response_file" -w '%{http_code}' \
    -X POST "$API_URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "repository: $REPO" \
    -H "Content-Type: application/json; charset=utf-8" \
    --data-binary @"$body_file")"

  if [[ "$status" == 2* ]]; then
    created=$((created + 1))
    echo "created  $name"
  else
    failed=$((failed + 1))
    echo "FAILED   $name (HTTP $status): $(cat "$response_file")"
    if (( created == 0 && failed == 1 )); then
      echo "The first request failed, so stopping here. Check the token, repository ID, locale and type ID."
      exit 1
    fi
  fi

  sleep 1.2   # the Migration API allows one request per second per repository
done

echo
echo "Done: $created created, $failed failed."
echo "Review and publish them in Prismic under Migration Releases."
