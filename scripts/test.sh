#!/bin/bash

echo TOKEN:

curl -k -X POST "https://zanotti.iliadboxos.it:55443/oauth-server/token" \
  -u "test:0123456789012345678901234" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=profile email" 

echo
echo INTROSPECTION:

curl -k -X POST "https://zanotti.iliadboxos.it:55443/oauth-server/token/introspection" \
  -u "test:0123456789012345678901234"\
  -H "content-type: application/x-www-form-urlencoded"\
  --data-urlencode "token=kiYpP1NRuxfXe6jKM86-ylrlxGc0iv8sFLF-tA-BDoV"\
  --data-urlencode "token_type_hint=access_token"

