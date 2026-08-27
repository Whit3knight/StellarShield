#![no_std]

//! R23: split out of `borrow-pool` so calls that never touch
//! `repay_shielded_v2` don't pay to parse this verifier's embedded VK
//! bytes + pairing-check code on every invocation — Soroban charges
//! WASM parse/instantiate cost per contract-code-hash in a
//! transaction's footprint, on the whole module, regardless of which
//! exported function is actually called. Discovered the hard way: a
//! real `deposit_shielded_quad` call (already near its own instruction
//! ceiling since R18) started exceeding the budget purely because
//! embedding this verifier directly in `borrow-pool` grew its WASM —
//! same root cause, same fix shape, as R17's `borrow-cap-helper` split.
//! Stateless: no `initialize`/admin surface, nothing to configure.

use soroban_sdk::{
    contract, contractimpl,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    vec, Env, Vec,
};

const VK_ALPHA: &[u8; 96] = include_bytes!("vk/vk_alpha.bin");
const VK_BETA: &[u8; 192] = include_bytes!("vk/vk_beta.bin");
const VK_GAMMA: &[u8; 192] = include_bytes!("vk/vk_gamma.bin");
const VK_DELTA: &[u8; 192] = include_bytes!("vk/vk_delta.bin");

const VK_IC_0: &[u8; 96] = include_bytes!("vk/vk_ic_0.bin");
const VK_IC_1: &[u8; 96] = include_bytes!("vk/vk_ic_1.bin");
const VK_IC_2: &[u8; 96] = include_bytes!("vk/vk_ic_2.bin");
const VK_IC_3: &[u8; 96] = include_bytes!("vk/vk_ic_3.bin");
const VK_IC_4: &[u8; 96] = include_bytes!("vk/vk_ic_4.bin");
const VK_IC_5: &[u8; 96] = include_bytes!("vk/vk_ic_5.bin");
const VK_IC_6: &[u8; 96] = include_bytes!("vk/vk_ic_6.bin");
const VK_IC_7: &[u8; 96] = include_bytes!("vk/vk_ic_7.bin");
const VK_IC_8: &[u8; 96] = include_bytes!("vk/vk_ic_8.bin");
const VK_IC_9: &[u8; 96] = include_bytes!("vk/vk_ic_9.bin");
const VK_IC_10: &[u8; 96] = include_bytes!("vk/vk_ic_10.bin");
const VK_IC_11: &[u8; 96] = include_bytes!("vk/vk_ic_11.bin");
const VK_IC_12: &[u8; 96] = include_bytes!("vk/vk_ic_12.bin");

#[contract]
pub struct RepayV2VerifierHelper;

#[contractimpl]
impl RepayV2VerifierHelper {
    pub fn verify(
        env: Env,
        proof_a: G1Affine,
        proof_b: G2Affine,
        proof_c: G1Affine,
        pub_signals: Vec<Fr>,
    ) -> bool {
        let ic_len = 13u32;
        if pub_signals.len() + 1 != ic_len {
            return false;
        }

        let alpha = G1Affine::from_array(&env, VK_ALPHA);
        let beta = G2Affine::from_array(&env, VK_BETA);
        let gamma = G2Affine::from_array(&env, VK_GAMMA);
        let delta = G2Affine::from_array(&env, VK_DELTA);
        let ic = ic_points(&env);

        let bls = env.crypto().bls12_381();

        let ic_tail: Vec<G1Affine> = ic.slice(1..ic.len());
        let msm = bls.g1_msm(ic_tail, pub_signals);
        let vk_x = bls.g1_add(&ic.get(0).unwrap(), &msm);

        let neg_a = -proof_a;
        let vp1 = vec![&env, neg_a, alpha, vk_x, proof_c];
        let vp2 = vec![&env, proof_b, beta, gamma, delta];

        bls.pairing_check(vp1, vp2)
    }
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
    ]
}
