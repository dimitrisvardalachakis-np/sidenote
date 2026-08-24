#!/bin/sh
# Next's Turbopack spawns pooled `node` subprocesses (the PostCSS loader among
# them) and finds them via PATH. Node lives under ~/.local on this machine
# rather than /usr/local, so the dev server must put it on PATH before exec'ing
# or those children die with ENOENT — and the resulting panic gets cached in
# .next, so a later fix looks like it did not work until you clear that too.
#
# Set SIDENOTE_SIGNED_OUT=1 here to exercise the (app) auth gate.
export PATH="$HOME/.local/node/bin:$PATH"
exec node node_modules/next/dist/bin/next dev --port 3000
