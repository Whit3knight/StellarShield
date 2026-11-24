pragma circom 2.1.9;

// Shielded pool liquidate circuit — v2 (Track A).
//
// Drops the sk-nullifier binding from the v1 circuit. A service
// worker holding only the memo openings (never the borrower's sk)
// can generate this proof. Contract wraps the verifier with a
// storage lookup: the loan_nullifier is pre-published in the
// LoanNullifier(loan_commitment) sidecar at borrow-time and
// cross-checked outside the circuit.
//
// Public signals order:
//   [0] borrow_amount_commit          from LiquidationBond
//   [1] collateral_value_commit       from LiquidationBond
//   [2] borrow_price_commit           from LiquidationBond
//   [3] current_price                 oracle-supplied; contract cross-checks
//                                     against a live Reflector read (R22)
//   [4] threshold_bps                 must match risk_params.liquidation_threshold_bps
//
// Private witness:
//   loan_amount, bond_salt_amount           borrow_amount_commit opening
//   collateral_notional, bond_salt_value    collateral_value_commit opening
//   borrow_price, bond_salt_price           borrow_price_commit opening
//
// R22: the underwater check below fixes two bugs the original v1/v2
// circuits shared (see docs/REMEDIATION.md R22 for the full writeup):
//   1. `collateral_notional` carries PRICE_RATIO_SCALE (1e14, matches
//      prices.ts) from being `raw_collateral * borrow_price` at open;
//      `loan_amount` doesn't. Comparing them directly (as this circuit
//      did before R22) is off by ~1e14x, which is why no proof could
//      ever satisfy it post-09471e9.
//   2. `threshold_bps`'s convention was backwards from
//      components/organisms/loan-health.ts (the code that renders the
//      "at risk" badge users see) — that file treats threshold_bps as
//      a max-LTV ceiling on loan/collateral; the old circuit treated it
//      as a floor on collateral/loan, the opposite relationship. This
//      circuit now matches loan-health.ts's convention.

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

template LiquidateV2() {
    // Public.
    signal input borrow_amount_commit;
    signal input collateral_value_commit;
    signal input borrow_price_commit;
    signal input current_price;
    signal input threshold_bps;

    // Private.
    signal input loan_amount;
    signal input bond_salt_amount;
    signal input collateral_notional;
    signal input bond_salt_value;
    signal input borrow_price;
    signal input bond_salt_price;

    // 1. Reconstruct + assert the 3 bond commitments.
    component bondAmount = Poseidon(2);
    bondAmount.inputs[0] <== loan_amount;
    bondAmount.inputs[1] <== bond_salt_amount;
    bondAmount.out === borrow_amount_commit;

    component bondValue = Poseidon(2);
    bondValue.inputs[0] <== collateral_notional;
    bondValue.inputs[1] <== bond_salt_value;
    bondValue.out === collateral_value_commit;

    component bondPrice = Poseidon(2);
    bondPrice.inputs[0] <== borrow_price;
    bondPrice.inputs[1] <== bond_salt_price;
    bondPrice.out === borrow_price_commit;

    // 2. Underwater inequality — identical math to v1 (R22).
    //
    // Target (matching loan-health.ts exactly): underwater when
    // `collateral_now * threshold_bps < loan_amount * 10000`, where
    // `collateral_now = collateral_notional * current_price /
    // (borrow_price * PRICE_SCALE)` is today's real collateral value in
    // loan-asset units, descaled from collateral_notional's open-time
    // price basis. An earlier version of this fix computed
    // `collateral_now` via a witness-supplied field division
    // (`<--` + `===`) — WRONG: circom's `/` is field-inverse division
    // (multiply by the modular inverse), not integer floor division,
    // so it only produces the intended small quotient when the
    // division happens to be exact. Real price ratios essentially
    // never divide evenly, so that version produced a ~253-bit
    // field-inverse artifact instead and failed Num2Bits for every
    // real (non-contrived) input. Fixed by cross-multiplying instead —
    // no division anywhere, mathematically equivalent (multiplying
    // both sides of the inequality by the same positive quantity,
    // `borrow_price * PRICE_SCALE`, preserves its direction):
    //
    //   collateral_notional * current_price * threshold_bps
    //     < loan_amount * 10000 * borrow_price * PRICE_SCALE
    var PRICE_SCALE = 100000000000000; // 1e14, matches prices.ts PRICE_RATIO_SCALE

    // Range bounds (circomspect `unconstrained-less-than`): `LessThan(200)`
    // is only sound when both inputs are < 2^200. Bound every operand so
    // lhs and rhs provably fit, instead of trusting the contract alone:
    //   lhs = cn * cp * thr  < 2^100 * 2^64 * 2^16 = 2^180
    //   rhs = la * bp * 1e18 < 2^64  * 2^64 * 2^60 = 2^188
    // 2^64 on a 1e14-scaled ratio allows ~184000x, far above any real
    // pair. current_price != 0 so a zero feed can never read as underwater.
    component cpBits = Num2Bits(64);
    cpBits.in <== current_price;
    component cpZero = IsZero();
    cpZero.in <== current_price;
    cpZero.out === 0;
    component bpBits = Num2Bits(64);
    bpBits.in <== borrow_price;
    component laBits = Num2Bits(64);
    laBits.in <== loan_amount;
    component cnBits = Num2Bits(100);
    cnBits.in <== collateral_notional;
    component thrBits = Num2Bits(16);
    thrBits.in <== threshold_bps;

    signal cn_cp;
    cn_cp <== collateral_notional * current_price;
    signal lhs;
    lhs <== cn_cp * threshold_bps;

    signal la_bp;
    la_bp <== loan_amount * borrow_price;
    // 10000 * PRICE_SCALE is a compile-time constant, folds into la_bp's
    // linear coefficient for free (no new constraint) — same trick R21
    // used for borrow.circom's PRICE_SCALE factor.
    signal rhs;
    rhs <== la_bp * (10000 * PRICE_SCALE);

    // Width: real proof data lands lhs/rhs around ~126 bits (measured
    // against a live testnet price); threshold_bps is circuit-
    // unconstrained u32 same as R21's hf_min_bps/max_ltv_bps, so this
    // uses generous headroom over the observed realistic magnitude
    // rather than the field's own ~253-bit ceiling — matches R21's
    // "comfortably safe for realistic values, contract-level trust for
    // the rest" judgment call. current_price/collateral_notional
    // themselves are NOT range-checked in-circuit; soundness against
    // an absurd value comes from the contract's live-price cross-check
    // (see lib.rs's live_oracle_price/verify_live_price call in
    // liquidate_shielded_v2) and fr_to_amount_checked, not from an
    // in-circuit bound — same split of responsibility R20 established
    // for oracle_price.
    // Explicit 200-bit bound on the comparator inputs themselves (implied by
    // the operand bounds above; stated directly so the invariant is local
    // to the comparison and visible to circomspect).
    component lhsBits = Num2Bits(200);
    lhsBits.in <== lhs;
    component rhsBits = Num2Bits(200);
    rhsBits.in <== rhs;

    component underwater = LessThan(200);
    underwater.in[0] <== lhs;
    underwater.in[1] <== rhs;
    underwater.out === 1;
}

component main {public [
    borrow_amount_commit,
    collateral_value_commit,
    borrow_price_commit,
    current_price,
    threshold_bps
]} = LiquidateV2();
