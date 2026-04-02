#!/usr/bin/env bash
set -euo pipefail

git add .
git commit -m "Update fileserver site"
git push
