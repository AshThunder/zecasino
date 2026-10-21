#!/bin/sh
# Seed comes from a Fly secret (ZEC_SEED_WORDS) and is written to tmpfs only, never to the image or volume.
set -eu
if [ -n "${ZEC_SEED_WORDS:-}" ]; then
  umask 077; printf '%s\n' "$ZEC_SEED_WORDS" > /run/house.mnemonic; unset ZEC_SEED_WORDS
  export ZEC_MNEMONIC=/run/house.mnemonic
fi
exec /usr/local/bin/app "$@"
