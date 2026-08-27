pragma circom 2.1.9;

// Jubjub-over-BLS12-381 twisted Edwards curve arithmetic + a
// fixed-base Pedersen commitment gadget (R20).
//
// Ported from circomlib's babyjub.circom/escalarmulfix.circom
// *structure* — same twisted-Edwards addition law, same general
// double-and-add scalar-mult approach — with Jubjub's own `d`
// constant and base points substituted in. Jubjub is a DIFFERENT
// curve from circomlib's "Baby Jubjub": Baby Jubjub is embedded in
// BN254's scalar field (a=168700, d=168696) and does not work over
// this project's BLS12-381 circuits; Jubjub is embedded in
// BLS12-381's OWN scalar field (a=-1, d below) — confirmed directly
// against zkcrypto/jubjub's source (`pub use bls12_381::Scalar as
// Fq`), the same curve Zcash Sapling uses for its value commitments.
// See contracts/borrow-pool/tests/jubjub_fixtures.txt for the exact
// reference values (generated from zkcrypto/jubjub v0.9.0) this file
// is checked against.
//
// Unlike circomlib's escalarmulfix.circom, this uses a PLAIN
// double-and-add scalar multiplication rather than a windowed/signed-
// digit optimization. Circomlib's windowed approach needs a
// "compensation accumulator" workaround specifically to avoid hitting
// exceptional points in ITS OWN precomputed-table indexing scheme —
// that workaround is not a general twisted-Edwards limitation: the
// addition law below is complete (handles doubling, adding the
// identity, etc. correctly with no special cases) by construction,
// which is the entire reason Zcash/circomlib chose this curve family.
// Plain double-and-add is simpler to audit and costs more constraints
// per bit than a windowed table — an acceptable trade for a testnet
// system where constraint count is not the binding constraint (see
// docs/REMEDIATION.md R20).

include "../../../../node_modules/circomlib/circuits/bitify.circom";

// EDWARDS_D: -(10240/10241) reduced mod the BLS12-381 scalar field —
// this is Jubjub's own curve constant, NOT Baby Jubjub's 168696.
// Curve equation: -u^2 + v^2 = 1 + d*u^2*v^2 (a = -1).
function JUBJUB_D() {
    return 19257038036680949359750312669786877991949435402254120286184196891950884077233;
}

// Complete twisted-Edwards addition (a = -1). Correct for adding two
// distinct points, doubling (x1=x2,y1=y2), and adding the identity
// (0,1) — no special-casing needed. See this file's header for why.
template JubjubAdd() {
    signal input x1, y1;
    signal input x2, y2;
    signal output xout, yout;

    var d = JUBJUB_D();

    signal beta, gamma, delta, tau;
    beta <== x1 * y2;
    gamma <== y1 * x2;
    delta <== (x1 + y1) * (x2 + y2);
    tau <== beta * gamma;

    xout <-- (beta + gamma) / (1 + d * tau);
    (1 + d * tau) * xout === (beta + gamma);

    // a = -1 case of the standard `yout = (y1y2 - a*x1x2) / (1 - d*tau)`:
    // -a*x1x2 = x1x2, and delta - beta - gamma = x1x2 + y1y2 (expand
    // delta = (x1+y1)(x2+y2) = x1x2 + x1y2 + y1x2 + y1y2, subtract
    // beta=x1y2 and gamma=y1x2 to isolate x1x2 + y1y2).
    yout <-- (delta - beta - gamma) / (1 - d * tau);
    (1 - d * tau) * yout === (delta - beta - gamma);
}

// Fixed-base scalar multiplication via plain double-and-add.
// BASE_X/BASE_Y are compile-time constants (template parameters);
// `scalar` is a circuit signal decomposed into NBITS bits internally
// (safe range: NBITS <= 251, strictly under Jubjub's own ~252-bit
// scalar-field order, so no wraparound ambiguity between "the integer
// the caller means" and "the group element actually produced" — see
// docs/REMEDIATION.md R20 for the exact bound derivation).
template JubjubScalarMulFix(BASE_X, BASE_Y, NBITS) {
    signal input scalar;
    signal output xout, yout;

    component bits = Num2Bits(NBITS);
    bits.in <== scalar;

    signal accX[NBITS + 1];
    signal accY[NBITS + 1];
    signal baseX[NBITS + 1];
    signal baseY[NBITS + 1];
    accX[0] <== 0;
    accY[0] <== 1;
    baseX[0] <== BASE_X;
    baseY[0] <== BASE_Y;

    component adders[NBITS];
    component doublers[NBITS];

    for (var i = 0; i < NBITS; i++) {
        adders[i] = JubjubAdd();
        adders[i].x1 <== accX[i];
        adders[i].y1 <== accY[i];
        adders[i].x2 <== baseX[i];
        adders[i].y2 <== baseY[i];

        // Select the sum when bit=1, else keep the accumulator
        // unchanged. bits.out[i] is already boolean-constrained by
        // Num2Bits.
        accX[i + 1] <== accX[i] + bits.out[i] * (adders[i].xout - accX[i]);
        accY[i + 1] <== accY[i] + bits.out[i] * (adders[i].yout - accY[i]);

        doublers[i] = JubjubAdd();
        doublers[i].x1 <== baseX[i];
        doublers[i].y1 <== baseY[i];
        doublers[i].x2 <== baseX[i];
        doublers[i].y2 <== baseY[i];
        baseX[i + 1] <== doublers[i].xout;
        baseY[i + 1] <== doublers[i].yout;
    }

    xout <== accX[NBITS];
    yout <== accY[NBITS];
}

// Pedersen commitment: commit = value*G + blinding*H, using this
// project's own hash-derived base points (see
// contracts/borrow-pool/tests/jubjub_fixtures.txt — domain-separated
// "StellarShieldJubjubG_v1"/"...H_v1", not reused from any existing
// Zcash/circomlib constant). `value`/`blinding` MUST both be < 2^251
// for the scalar-mult bound above to hold — callers are responsible
// for that (real note amounts are bounded by MAX_NOTE_AMOUNT, ~60
// bits, and blinding factors must be generated under 2^251 client-side,
// not as arbitrary full BLS12-381 Fr elements).
template PedersenCommit() {
    signal input value;
    signal input blinding;
    signal output xout, yout;

    var gx = 545456359973948155769872378749498824460258321761104478527435041830372504831;
    var gy = 49168021754723060897404268566641009060342307409428241201721083971066165481700;
    var hx = 20188423121429103911011442364622453815900702521639428791702758426731349062351;
    var hy = 2305740674284689672646006590853220375401077865348894685059150281230003633558;

    component mulG = JubjubScalarMulFix(gx, gy, 251);
    mulG.scalar <== value;

    component mulH = JubjubScalarMulFix(hx, hy, 251);
    mulH.scalar <== blinding;

    component sum = JubjubAdd();
    sum.x1 <== mulG.xout;
    sum.y1 <== mulG.yout;
    sum.x2 <== mulH.xout;
    sum.y2 <== mulH.yout;

    xout <== sum.xout;
    yout <== sum.yout;
}
