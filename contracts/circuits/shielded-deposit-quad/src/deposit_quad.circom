pragma circom 2.2.3;

// Shielded-deposit quad: proves that FOUR deposit-note commitments are
// well-formed for the same amount + asset_tag + shielded identity `sk`.
// A single Groth16 verification on-chain then accepts all four leaves,
// so the wallet-side deposit UX collapses from 4 signatures + 4 tx
// verifications into 1 signature + 1 tx verification. Matches the
// per-note constraint from `deposit.circom`:
//     commitment_i == Poseidon(amount, asset_tag, sk, salt_i)
// but shared across four notes at once.
//
// Public signals (snarkjs orders circuit outputs first, declared
// publics after):
//   [0..3] commitment[0..3]
//   [4]    amount
//   [5]    asset_tag
//
// Private witness:
//   sk       — user's shielded identity secret (shared across notes)
//   salt[4]  — random blinding per note

include "circomlib/circuits/poseidon.circom";

template DepositQuad() {
    signal input amount;
    signal input asset_tag;
    signal input sk;
    signal input salt[4];
    signal output commitment[4];

    component p[4];
    for (var i = 0; i < 4; i++) {
        p[i] = Poseidon(4);
        p[i].inputs[0] <== amount;
        p[i].inputs[1] <== asset_tag;
        p[i].inputs[2] <== sk;
        p[i].inputs[3] <== salt[i];
        commitment[i] <== p[i].out;
    }
}

component main {public [amount, asset_tag]} = DepositQuad();
