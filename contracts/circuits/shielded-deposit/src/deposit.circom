pragma circom 2.1.9;

// Shielded pool deposit-note circuit.
//
// Proves that `commitment = Poseidon(amount, asset_tag, sk, salt)` is
// well formed for the amount + asset_tag the deposit tx declares.
// The contract additionally enforces `amount == denomination(asset)`
// via a plain comparison in Rust — no circuit constraint needed —
// which keeps this circuit ~1k constraints instead of embedding
// per-asset denomination tables.
//
// Public signals (order matches BorrowPool::deposit_shielded):
//   [0] amount        (fixed denomination, RAW token units)
//   [1] asset_tag     (0 = XLM, 1 = USDC, 2 = EURC)
//   [2] commitment    (Poseidon output, stored as new leaf in the tree)
//
// Private witness:
//   sk    — user's shielded identity secret
//   salt  — random blinding factor per note

include "circomlib/circuits/poseidon.circom";

template DepositNote() {
    signal input amount;
    signal input asset_tag;
    signal input sk;
    signal input salt;
    signal output commitment;

    component p = Poseidon(4);
    p.inputs[0] <== amount;
    p.inputs[1] <== asset_tag;
    p.inputs[2] <== sk;
    p.inputs[3] <== salt;
    commitment <== p.out;
}

component main {public [amount, asset_tag]} = DepositNote();
