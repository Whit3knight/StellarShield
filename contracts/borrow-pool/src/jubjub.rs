//! Jubjub-over-BLS12-381 point addition (R20) — the contract-side
//! twin of `contracts/circuits/shielded-borrow/src/jubjub_pedersen.
//! circom`'s `JubjubAdd` template. Used to fold each borrow's Pedersen
//! commitment (a public circuit output) into a running per-asset
//! aggregate via elliptic-curve addition, without the contract ever
//! learning the committed amount.
//!
//! Jubjub is a twisted Edwards curve `-u^2 + v^2 = 1 + d*u^2*v^2`
//! (a = -1) whose base field is *literally* BLS12-381's scalar field
//! (confirmed against `zkcrypto/jubjub`'s source: `pub use bls12_381::
//! Scalar as Fq`) — the same field this contract's `Fr` type already
//! is. That's what makes this file possible: point coordinates are
//! ordinary `Fr` values, and `env.crypto().bls12_381()`'s `fr_add`/
//! `fr_sub`/`fr_mul`/`fr_inv` are enough to implement the addition
//! law directly, with no non-native field arithmetic and no G1/G2
//! host primitives involved (Jubjub is a different curve from the
//! BLS12-381 G1/G2 groups used elsewhere in this contract for Groth16
//! verification).
//!
//! Every constant here is cross-checked against
//! `contracts/borrow-pool/tests/jubjub_fixtures.txt`, generated from
//! the reference `zkcrypto/jubjub` v0.9.0 crate (the same
//! implementation Zcash Sapling itself is built on) — not hand-derived.
//! Do not edit the constants below without regenerating and re-checking
//! against that fixture file first.

#![allow(dead_code)]

use soroban_sdk::{contracttype, crypto::bls12_381::Fr, BytesN, Env};

fn fr_from_hex_be(env: &Env, hex_be: &[u8; 32]) -> Fr {
    Fr::from_bytes(BytesN::from_array(env, hex_be))
}

/// Jubjub's curve constant `d = -(10240/10241)` reduced mod the
/// BLS12-381 scalar field. NOT circomlib Baby Jubjub's `168696` — a
/// different curve, different field. See `jubjub_fixtures.txt`'s
/// `EDWARDS_D`.
fn edwards_d(env: &Env) -> Fr {
    fr_from_hex_be(
        env,
        &[
            0x2a, 0x93, 0x18, 0xe7, 0x4b, 0xfa, 0x2b, 0x48, 0xf5, 0xfd, 0x92, 0x07, 0xe6, 0xbd,
            0x7f, 0xd4, 0x29, 0x2d, 0x7f, 0x6d, 0x37, 0x57, 0x9d, 0x26, 0x01, 0x06, 0x5f, 0xd6,
            0xd6, 0x34, 0x3e, 0xb1,
        ],
    )
}

/// A point on the Jubjub curve, represented in affine `(u, v)`
/// coordinates as raw `Fr` field elements.
#[contracttype]
#[derive(Clone, Debug)]
pub struct JubjubPoint {
    pub u: Fr,
    pub v: Fr,
}

impl JubjubPoint {
    /// The curve's identity element `(0, 1)` — the default value for
    /// a fresh `RunningCollateralCommit`/`RunningLoanCommit` counter
    /// before any borrow has occurred. Matches `jubjub_fixtures.txt`'s
    /// `IDENTITY`.
    pub fn identity(env: &Env) -> Self {
        JubjubPoint {
            u: Fr::from_u256(soroban_sdk::U256::from_u32(env, 0)),
            v: Fr::from_u256(soroban_sdk::U256::from_u32(env, 1)),
        }
    }
}

/// Complete twisted-Edwards addition (a = -1) — the exact formula
/// implemented in `jubjub_pedersen.circom`'s `JubjubAdd` template.
/// Correct for adding two distinct points, doubling, and adding the
/// identity; see that file's header comment for why no special-casing
/// is needed.
pub fn jubjub_add(env: &Env, p1: &JubjubPoint, p2: &JubjubPoint) -> JubjubPoint {
    let bls = env.crypto().bls12_381();
    let d = edwards_d(env);

    let beta = bls.fr_mul(&p1.u, &p2.v);
    let gamma = bls.fr_mul(&p1.v, &p2.u);
    let delta = bls.fr_mul(&bls.fr_add(&p1.u, &p1.v), &bls.fr_add(&p2.u, &p2.v));
    let tau = bls.fr_mul(&beta, &gamma);

    let one = Fr::from_u256(soroban_sdk::U256::from_u32(env, 1));
    let d_tau = bls.fr_mul(&d, &tau);

    let x_denom = bls.fr_add(&one, &d_tau);
    let x_numer = bls.fr_add(&beta, &gamma);
    let xout = bls.fr_mul(&x_numer, &x_denom.inv());

    // delta - beta - gamma = u1*u2 + v1*v2 (see jubjub_pedersen.circom's
    // JubjubAdd comment for the algebraic expansion).
    let y_numer = bls.fr_sub(&bls.fr_sub(&delta, &beta), &gamma);
    let y_denom = bls.fr_sub(&one, &d_tau);
    let yout = bls.fr_mul(&y_numer, &y_denom.inv());

    JubjubPoint { u: xout, v: yout }
}
