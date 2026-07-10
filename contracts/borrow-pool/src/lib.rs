#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN,
    Env, Symbol,
};

mod verifier;

// ponytail: skeleton contract. Real pool needs liquidity accounting, oracle
// price lookups, interest accrual, and repay/liquidate paths. Add each when
// its economics are pinned down.

/// Maximum age of an oracle epoch relative to the current ledger timestamp.
/// Proofs whose `oracle_epoch` fall outside this window are rejected as
/// stale. 60 s balances proof precompute latency against oracle drift.
pub const MAX_ORACLE_AGE_SECS: u64 = 60;

#[contracttype]
#[derive(Clone)]
pub struct BorrowIntent {
    pub account: Address,
    pub proof_id: BytesN<32>,
    pub market: Symbol,
    pub collateral_symbol: Symbol,
    pub collateral_amount: i128,
    pub borrow_symbol: Symbol,
    pub borrow_amount: i128,
    pub health_factor_bps: u32,
    pub max_ltv_bps: u32,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct BorrowProof {
    /// Serialized Groth16 proof: A (G1) || B (G2) || C (G1).
    pub proof_bytes: Bytes,
    /// Oracle epoch the proof was generated against.
    pub oracle_epoch: u64,
    /// Poseidon2 commitment to (oracle_price, salt) the prover used.
    pub oracle_price_commitment: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct BorrowReceipt {
    pub account: Address,
    pub proof_id: BytesN<32>,
    pub borrow_symbol: Symbol,
    pub borrow_amount: i128,
    pub collateral_symbol: Symbol,
    pub collateral_amount: i128,
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
    InvalidAmount = 3,
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

        if intent.borrow_amount <= 0 || intent.collateral_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let now = env.ledger().timestamp();
        if intent.expires_at != 0 && now > intent.expires_at {
            return Err(Error::IntentExpired);
        }

        // Oracle freshness: reject any proof whose epoch is older than
        // MAX_ORACLE_AGE_SECS relative to the current ledger. Also
        // reject future-dated epochs — those signal a broken oracle.
        if proof.oracle_epoch > now || now - proof.oracle_epoch > MAX_ORACLE_AGE_SECS {
            return Err(Error::StaleOracle);
        }

        // Groth16 verify. Circuit binds proof to the intent's account,
        // market, symbols, amounts, thresholds, oracle_epoch, and
        // oracle_price_commitment via public inputs. Any tampered
        // field flips the public-input vector and fails verify.
        if !verifier::verify_groth16(&env, &intent, &proof) {
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
            borrow_symbol: intent.borrow_symbol.clone(),
            borrow_amount: intent.borrow_amount,
            collateral_symbol: intent.collateral_symbol.clone(),
            collateral_amount: intent.collateral_amount,
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
