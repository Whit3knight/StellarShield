//! Groth16 verifier for the shielded-liquidate v2 circuit (Track A).
//!
//! Public signals:
//!   [0] borrow_amount_commit          from LiquidationBond
//!   [1] collateral_value_commit       from LiquidationBond
//!   [2] borrow_price_commit           from LiquidationBond
//!   [3] current_price                 oracle-supplied
//!   [4] threshold_bps                 matches risk_params.liquidation_threshold_bps
//!
//! `loan_commitment` + `loan_nullifier` live outside the circuit —
//! the caller passes them as tx args and the contract cross-checks
//! against the LiquidationBond + LoanNullifier sidecar.

use soroban_sdk::{
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    vec, Env, Vec,
};

const VK_ALPHA: &[u8; 96] = include_bytes!("vk/liquidate_v2/vk_alpha.bin");
const VK_BETA: &[u8; 192] = include_bytes!("vk/liquidate_v2/vk_beta.bin");
const VK_GAMMA: &[u8; 192] = include_bytes!("vk/liquidate_v2/vk_gamma.bin");
const VK_DELTA: &[u8; 192] = include_bytes!("vk/liquidate_v2/vk_delta.bin");

const VK_IC_0: &[u8; 96] = include_bytes!("vk/liquidate_v2/vk_ic_0.bin");
const VK_IC_1: &[u8; 96] = include_bytes!("vk/liquidate_v2/vk_ic_1.bin");
const VK_IC_2: &[u8; 96] = include_bytes!("vk/liquidate_v2/vk_ic_2.bin");
const VK_IC_3: &[u8; 96] = include_bytes!("vk/liquidate_v2/vk_ic_3.bin");
const VK_IC_4: &[u8; 96] = include_bytes!("vk/liquidate_v2/vk_ic_4.bin");
const VK_IC_5: &[u8; 96] = include_bytes!("vk/liquidate_v2/vk_ic_5.bin");

pub fn verify_groth16(
    env: &Env,
    proof_a: G1Affine,
    proof_b: G2Affine,
    proof_c: G1Affine,
    pub_signals: Vec<Fr>,
) -> bool {
    let ic_len = 6u32;
    if pub_signals.len() + 1 != ic_len {
        return false;
    }

    let alpha = G1Affine::from_array(env, VK_ALPHA);
    let beta = G2Affine::from_array(env, VK_BETA);
    let gamma = G2Affine::from_array(env, VK_GAMMA);
    let delta = G2Affine::from_array(env, VK_DELTA);
    let ic = ic_points(env);

    let bls = env.crypto().bls12_381();

    let mut vk_x = ic.get(0).unwrap();
    for (index, signal) in pub_signals.iter().enumerate() {
        let ic_point = ic.get((index as u32) + 1).unwrap();
        let prod = bls.g1_mul(&ic_point, &signal);
        vk_x = bls.g1_add(&vk_x, &prod);
    }

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
    ]
}
