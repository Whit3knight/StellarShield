//! Groth16 verifier for the shielded-borrow circuit.
//!
//! Public signals (matches BorrowPool::borrow_shielded). Circuit OUTPUTS
//! sort before {public [...]}-listed INPUTS in snarkjs's ordering. R20
//! replaced the two amount signals (`total_collateral_amount`,
//! `borrow_amount` — now pure private witnesses) with four Jubjub
//! Pedersen commitment outputs, and promoted `oracle_price` from
//! private witness to public input — verified empirically against the
//! compiled circuit's .sym table, not assumed:
//!   [0]      collateral_pedersen_u        (R20: Pedersen commit to total_collateral_amount)
//!   [1]      collateral_pedersen_v
//!   [2]      loan_pedersen_u              (R20: Pedersen commit to borrow_amount)
//!   [3]      loan_pedersen_v
//!   [4]      oracle_price                 (R20: now public, contract-verified against live Reflector)
//!   [5]      borrow_asset_tag
//!   [6]      collateral_asset_tag
//!   [7]      hf_min_bps
//!   [8]      max_ltv_bps
//!   [9]      deposit_root
//!   [10]     borrow_commitment
//!   [11..15] nullifiers[0..4]
//!   [15]     borrow_amount_commit         (Track L bond)
//!   [16]     collateral_value_commit      (Track L bond)
//!   [17]     borrow_price_commit          (Track L bond)
//!   [18]     loan_nullifier               (Track A pre-published)

use soroban_sdk::{
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    vec, Env, Vec,
};

const VK_ALPHA: &[u8; 96] = include_bytes!("vk/borrow/vk_alpha.bin");
const VK_BETA: &[u8; 192] = include_bytes!("vk/borrow/vk_beta.bin");
const VK_GAMMA: &[u8; 192] = include_bytes!("vk/borrow/vk_gamma.bin");
const VK_DELTA: &[u8; 192] = include_bytes!("vk/borrow/vk_delta.bin");

const VK_IC_0: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_0.bin");
const VK_IC_1: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_1.bin");
const VK_IC_2: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_2.bin");
const VK_IC_3: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_3.bin");
const VK_IC_4: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_4.bin");
const VK_IC_5: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_5.bin");
const VK_IC_6: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_6.bin");
const VK_IC_7: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_7.bin");
const VK_IC_8: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_8.bin");
const VK_IC_9: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_9.bin");
const VK_IC_10: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_10.bin");
const VK_IC_11: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_11.bin");
const VK_IC_12: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_12.bin");
const VK_IC_13: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_13.bin");
const VK_IC_14: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_14.bin");
const VK_IC_15: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_15.bin");
const VK_IC_16: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_16.bin");
const VK_IC_17: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_17.bin");
const VK_IC_18: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_18.bin");
const VK_IC_19: &[u8; 96] = include_bytes!("vk/borrow/vk_ic_19.bin");

pub fn verify_groth16(
    env: &Env,
    proof_a: G1Affine,
    proof_b: G2Affine,
    proof_c: G1Affine,
    pub_signals: Vec<Fr>,
) -> bool {
    let ic_len = 20u32;
    if pub_signals.len() + 1 != ic_len {
        return false;
    }

    let alpha = G1Affine::from_array(env, VK_ALPHA);
    let beta = G2Affine::from_array(env, VK_BETA);
    let gamma = G2Affine::from_array(env, VK_GAMMA);
    let delta = G2Affine::from_array(env, VK_DELTA);
    let ic = ic_points(env);

    let bls = env.crypto().bls12_381();

    // R20: batched multi-scalar-multiplication instead of one `g1_mul`
    // + `g1_add` pair per public signal. Each extra public signal this
    // circuit gained (16 -> 19) added a separate full G1 scalar mult to
    // the old per-signal loop, which pushed a real borrow_shielded call
    // over the network's per-tx instruction ceiling (measured on a temp
    // testnet deploy: ~402.2M against a 400M cap) — `g1_msm` computes
    // the same `Σ ic[i+1] * signal[i]` in one batched host call instead
    // of `pub_signals.len()` separate ones, which is what recovers the
    // budget. Verified byte-identical `vk_x` output against the old
    // per-signal loop before removing it.
    let ic_tail: Vec<G1Affine> = ic.slice(1..ic.len());
    let msm = bls.g1_msm(ic_tail, pub_signals);
    let vk_x = bls.g1_add(&ic.get(0).unwrap(), &msm);

    let neg_a = -proof_a;
    let vp1 = vec![env, neg_a, alpha, vk_x, proof_c];
    let vp2 = vec![env, proof_b, beta, gamma, delta];

    bls.pairing_check(vp1, vp2)
}

fn ic_points(env: &Env) -> Vec<G1Affine> {
    vec![
        env,
        G1Affine::from_array(env, VK_IC_0),
        G1Affine::from_array(env, VK_IC_1),
        G1Affine::from_array(env, VK_IC_2),
        G1Affine::from_array(env, VK_IC_3),
        G1Affine::from_array(env, VK_IC_4),
        G1Affine::from_array(env, VK_IC_5),
        G1Affine::from_array(env, VK_IC_6),
        G1Affine::from_array(env, VK_IC_7),
        G1Affine::from_array(env, VK_IC_8),
        G1Affine::from_array(env, VK_IC_9),
        G1Affine::from_array(env, VK_IC_10),
        G1Affine::from_array(env, VK_IC_11),
        G1Affine::from_array(env, VK_IC_12),
        G1Affine::from_array(env, VK_IC_13),
        G1Affine::from_array(env, VK_IC_14),
        G1Affine::from_array(env, VK_IC_15),
        G1Affine::from_array(env, VK_IC_16),
        G1Affine::from_array(env, VK_IC_17),
        G1Affine::from_array(env, VK_IC_18),
        G1Affine::from_array(env, VK_IC_19),
    ]
}
