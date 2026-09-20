#!/usr/bin/env bash
set -euo pipefail

git add .
git commit -m "Update watermarks site"
git push
