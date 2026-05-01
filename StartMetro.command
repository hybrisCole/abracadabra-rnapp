#!/bin/bash
# Double-click in Finder (or run from Terminal) to start Metro with Node from nvm.
cd "$(dirname "$0")" || exit 1

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

nvm use 25
exec npm start
