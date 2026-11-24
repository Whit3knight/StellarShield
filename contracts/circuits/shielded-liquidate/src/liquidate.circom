pragma circom 2.1.9;

// Shielded pool liquidation circuit (Track L phase 3).
//
// A liquidator holding the memo openings for an underwater loan proves,
// without revealing the borrower or the exact amounts, that:
//   1. `loan_commitment` opens under the private witness (sk, salt).
//   2. The 3 bond commitments pinned at borrow-time match the private
//      openings (loan_amount, collateral_notional, borrow_price).
//   3. The loan is underwater at the caller-supplied `current_price`:
//        collateral_now * threshold_bps < loan_amount * 10_000
//      where collateral_now = collateral_notional * current_price /
//      (borrow_price * PRICE_SCALE) — see the R22 comment below.
//   4. `loan_nullifier = Poseidon(sk, loan_index)` matches, so the
//      contract can burn the note atomically with the trigger.
//
// Contract cross-checks:
//   - `current_price` freshness via oracle epoch, AND (R22) magnitude
//     against a live Reflector read.
//   - `threshold_bps` matches its own risk_params.
//   - The 3 bond commitments match the stored LiquidationBond keyed by
//     `loan_commitment`.
//
// R22: the underwater check fixes two bugs the original circuit had
// (see docs/REMEDIATION.md R22): a missing PRICE_SCALE divisor
// (~1e14x too loose, why no proof could satisfy it post-09471e9,
// exactly the R21 bug class) and a threshold_bps convention backwards
// from components/organisms/loan-health.ts (the UI's own "at risk"
// math) — this circuit now matches that convention.
//
// Public signals order:
//   [0] loan_commitment
//   [1] borrow_amount_commit
//   [2] collateral_value_commit
//   [3] borrow_price_commit
//   [4] current_price
//   [5] threshold_bps
//   [6] loan_nullifier
//
// Private witness:
//   sk                     borrower secret (leaked to service via memo)
//   loan_asset_tag         encoded in the loan commitment
//   loan_salt              blinding for the loan note
//   loan_index             tree position (for nullifier)
//   loan_amount            borrow_amount opening
//   bond_salt_amount       borrow_amount_commit opening
//   collateral_notional    collateral_value opening (loan-asset units)
//   bond_salt_value        collateral_value_commit opening
//   borrow_price           borrow_price_commit opening
//   bond_salt_price        borrow_price_commit opening

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

template Liquidate() {
    // Public.
    signal input loan_commitment;
    signal input borrow_amount_commit;
    signal input collateral_value_commit;
    signal input borrow_price_commit;
    signal input current_price;
    signal input threshold_bps;
    signal input loan_nullifier;

    // Private.
    signal input sk;
    signal input loan_asset_tag;
    signal input loan_salt;
    signal input loan_index;
    signal input loan_amount;
    signal input bond_salt_amount;
    signal input collateral_notional;
    signal input bond_salt_value;
    signal input borrow_price;
    signal input bond_salt_price;

    // 1. Reconstruct the loan commitment.
    component loanCommit = Poseidon(4);
    loanCommit.inputs[0] <== loan_amount;
    loanCommit.inputs[1] <== loan_asset_tag;
    loanCommit.inputs[2] <== sk;
    loanCommit.inputs[3] <== loan_salt;
    loanCommit.out === loan_commitment;

    // 2. Reconstruct the 3 bond commitments.
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

    // 3. Underwater check (R22 — see this file's header comment, and
    // shielded-liquidate-v2's twin of this comment for why this is a
    // cross-multiplication rather than a witness-division: field `/`
    // is inverse multiplication, not integer floor division, and only
    // gives the intended quotient when the division is exact — real
    // price ratios essentially never are).
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
    signal rhs;
    rhs <== la_bp * (10000 * PRICE_SCALE);

    // Width — see shielded-liquidate-v2's identical comment: generous
    // headroom over the ~126-bit magnitude real proof data lands at,
    // not the field's own ~253-bit ceiling. Soundness against an
    // absurd current_price comes from the contract's live-price
    // cross-check, not an in-circuit bound.
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

    // 4. Nullifier binds the loan to (sk, loan_index).
    component nullifier = Poseidon(2);
    nullifier.inputs[0] <== sk;
    nullifier.inputs[1] <== loan_index;
    nullifier.out === loan_nullifier;
}

component main {public [
    loan_commitment,
    borrow_amount_commit,
    collateral_value_commit,
    borrow_price_commit,
    current_price,
    threshold_bps,
    loan_nullifier
]} = Liquidate();
