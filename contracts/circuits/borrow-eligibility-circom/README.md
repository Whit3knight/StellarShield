# Borrow Eligibility — Circom edition

Groth16 circuit over BN254 for the Stellar Shield borrow-eligibility
statement. Same semantics as the Noir sibling in
`../borrow-eligibility/` — different DSL, mature tooling.

## Prereqs

```bash
# Circom compiler (Rust)
cargo install --git https://github.com/iden3/circom.git circom

# snarkjs (JS/npm) — already installed at the repo root
bun add snarkjs

# Circom stdlib (npm) — install into this circuit dir
cd contracts/circuits/borrow-eligibility-circom
bun add circomlib
```

## Compile

```bash
cd contracts/circuits/borrow-eligibility-circom

# 1. Compile Circom → R1CS + WASM (used by snarkjs prover)
circom src/borrow_eligibility.circom \
  --r1cs --wasm --sym \
  -l node_modules \
  -o build

# 2. Powers of Tau (skip if you already downloaded pot14_final.ptau):
curl -Lo build/pot14_final.ptau \
  https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau

# 3. Groth16 trusted setup
snarkjs groth16 setup \
  build/borrow_eligibility.r1cs \
  build/pot14_final.ptau \
  build/borrow_eligibility.zkey

# 4. Export verification key
snarkjs zkey export verificationkey \
  build/borrow_eligibility.zkey \
  build/verification_key.json

# 5. Vendor artefacts for the app
mkdir -p ../../../features/proofs/circuits-circom
cp build/borrow_eligibility_js/borrow_eligibility.wasm \
   ../../../features/proofs/circuits-circom/
cp build/borrow_eligibility.zkey \
   ../../../features/proofs/circuits-circom/
cp build/verification_key.json \
   ../../../features/proofs/circuits-circom/
```

## Test the circuit locally

```bash
snarkjs groth16 fullprove \
  input.json \
  build/borrow_eligibility_js/borrow_eligibility.wasm \
  build/borrow_eligibility.zkey \
  build/proof.json \
  build/public.json

snarkjs groth16 verify \
  build/verification_key.json \
  build/public.json \
  build/proof.json
```

Where `input.json` matches the circuit signal names, e.g.

```json
{
  "account": "1",
  "market": "2",
  "proof_id": "3",
  "collateral_symbol": "4",
  "borrow_symbol": "5",
  "collateral_amount": "1000",
  "borrow_amount": "500",
  "hf_min_bps": "20000",
  "max_ltv_bps": "6300",
  "oracle_epoch": "42",
  "oracle_price": "2",
  "oracle_price_salt": "12345",
  "raw_collateral_balance": "1000"
}
```

## Contract-side verifier

The Nethermind/SDF Soroban Groth16 verifier lives at
`contracts/borrow-pool/src/verifier_groth16.rs` (added when this pipeline
lands). Verification-key constants come from `verification_key.json`,
extracted by `contracts/scripts/vk-json-to-rust.ts`.
