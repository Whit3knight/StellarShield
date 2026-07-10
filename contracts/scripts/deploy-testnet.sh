#!/usr/bin/env bash
# Deploy the borrow-pool contract to Stellar testnet.
#
# Prereqs:
#   - stellar-cli installed  (`cargo install --locked stellar-cli`)
#   - a testnet-funded source account
#   - source account keypair configured via `stellar keys generate` or
#     `stellar keys add` and referenced by name below.
#
# Usage:
#   contracts/scripts/deploy-testnet.sh <source-account-name>
#
# On success prints the contract id. Copy it into `.env.local` as
# NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID and set
# NEXT_PUBLIC_STELLAR_SHIELD_ADAPTER=soroban to route the app through
# the real contract.

set -euo pipefail

SOURCE="${1:-}"
if [ -z "$SOURCE" ]; then
  echo "usage: $0 <source-account-name>" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
CONTRACTS_DIR="$REPO_ROOT/contracts"
WASM="$CONTRACTS_DIR/target/wasm32v1-none/release/borrow_pool.wasm"

echo "==> Building borrow-pool WASM"
(cd "$CONTRACTS_DIR" && cargo build --release --target wasm32v1-none)

if [ ! -f "$WASM" ]; then
  echo "error: $WASM missing after build" >&2
  exit 1
fi

echo "==> Deploying to testnet as $SOURCE"
stellar contract deploy \
  --wasm "$WASM" \
  --source "$SOURCE" \
  --network testnet
