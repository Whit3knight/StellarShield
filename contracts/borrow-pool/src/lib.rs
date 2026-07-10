#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    symbol_short, Address, BytesN, Env, Symbol, Vec,
};

mod verifier;

// ponytail: skeleton contract. Real pool needs liquidity accounting, oracle
// price lookups, interest accrual, and repay/liquidate paths. Add each when
// its economics are pinned down.

/// Maximum age of an oracle epoch relative to the current ledger timestamp.
/// Proofs whose `oracle_epoch` fall outside this window are rejected as
/// stale. 60 s balances proof precompute latency against oracle drift.
pub const MAX_ORACLE_AGE_SECS: u64 = 60;

/// Phase-1 privacy: amount fields moved to circuit-private witness.
/// Chain no longer sees the raw borrow / collateral amounts — only the
/// policy thresholds, market context, and account (still visible via
/// tx source auth). Phase 2 will swap `account` for a nullifier.
#[contracttype]
#[derive(Clone)]
pub struct BorrowIntent {
    pub account: Address,
    pub proof_id: BytesN<32>,
    pub market: Symbol,
    pub collateral_symbol: Symbol,
    pub borrow_symbol: Symbol,
    pub health_factor_bps: u32,
    pub max_ltv_bps: u32,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct BorrowProof {
    /// Groth16 proof over BLS12-381: A (G1) + B (G2) + C (G1).
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
    /// Public signals in circuit-declaration order followed by the
    /// public output (`oracle_price_commitment`) — total 11 entries.
    pub public_signals: Vec<Fr>,
    /// Oracle epoch the proof was generated against. Cross-check against
    /// the current ledger timestamp for freshness.
    pub oracle_epoch: u64,
}

/// Anonymized receipt: no borrow / collateral amounts. Users store
/// their own numbers client-side (session store). Chain records only
/// the fact that a proof-backed position exists.
#[contracttype]
#[derive(Clone)]
pub struct BorrowReceipt {
    pub account: Address,
    pub proof_id: BytesN<32>,
    pub market: Symbol,
    pub borrow_symbol: Symbol,
    pub collateral_symbol: Symbol,
    pub confirmed_at: u64,
}

#[contracttype]
enum DataKey {
    Position(Address),
    ProofUsed(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    IntentExpired = 1,
    ProofReplayed = 2,
    // Phase-1: amount validity is asserted inside the circuit's
    // private-witness constraints — no chain-side amount error.
    Reserved3 = 3,
    StaleOracle = 4,
    InvalidProof = 5,
}

const BORROW_EVENT: Symbol = symbol_short!("borrow");

#[contract]
pub struct BorrowPool;

#[contractimpl]
impl BorrowPool {
    pub fn borrow(
        env: Env,
        intent: BorrowIntent,
        proof: BorrowProof,
    ) -> Result<BorrowReceipt, Error> {
        intent.account.require_auth();

        // Amounts live inside the circuit as private witness — the
        // proof itself asserts positivity + range. No chain-side amount
        // check possible without breaking privacy.

        let now = env.ledger().timestamp();
        if intent.expires_at != 0 && now > intent.expires_at {
            return Err(Error::IntentExpired);
        }

        // Oracle freshness.
        if proof.oracle_epoch > now || now - proof.oracle_epoch > MAX_ORACLE_AGE_SECS {
            return Err(Error::StaleOracle);
        }

        // Groth16 verify. Public signals order matches the circuit's
        // public inputs (account, market, proof_id, collateral_symbol,
        // borrow_symbol, collateral_amount, borrow_amount, hf_min_bps,
        // max_ltv_bps, oracle_epoch) followed by the public output
        // (oracle_price_commitment).
        if !verifier::verify_groth16(
            &env,
            proof.a.clone(),
            proof.b.clone(),
            proof.c.clone(),
            proof.public_signals.clone(),
        ) {
            return Err(Error::InvalidProof);
        }

        let proof_key = DataKey::ProofUsed(intent.proof_id.clone());
        let storage = env.storage().persistent();
        if storage.has(&proof_key) {
            return Err(Error::ProofReplayed);
        }
        storage.set(&proof_key, &true);

        let receipt = BorrowReceipt {
            account: intent.account.clone(),
            proof_id: intent.proof_id.clone(),
            market: intent.market.clone(),
            borrow_symbol: intent.borrow_symbol.clone(),
            collateral_symbol: intent.collateral_symbol.clone(),
            confirmed_at: now,
        };

        storage.set(&DataKey::Position(intent.account.clone()), &receipt);
        env.events().publish((BORROW_EVENT,), receipt.clone());

        Ok(receipt)
    }

    pub fn position(env: Env, account: Address) -> Option<BorrowReceipt> {
        env.storage()
            .persistent()
            .get(&DataKey::Position(account))
    }
}
