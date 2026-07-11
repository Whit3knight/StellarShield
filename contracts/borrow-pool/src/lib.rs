#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    symbol_short, Address, BytesN, Env, Symbol, Vec,
};

mod verifier;

// ponytail: skeleton contract. Real pool needs liquidity accounting, interest
// accrual, and repay/liquidate paths. Reflector price commitment cross-check
// stays on the roadmap — recomputing the circuit's Poseidon output on-chain
// requires either a BLS12-381 Poseidon crate or a circuit switch to SHA256.

/// Maximum age of an oracle epoch relative to the current ledger timestamp.
/// Proofs whose `oracle_epoch` fall outside this window are rejected as
/// stale.
///
/// 5 min covers a realistic UX where the user precomputes a proof at
/// amount-blur, then hesitates before hitting Submit. Real production
/// tightens this (30–60 s) once auto re-prove on stale is wired.
pub const MAX_ORACLE_AGE_SECS: u64 = 300;

/// Grace for slight clock drift between the user's browser and the
/// ledger. Accepts proofs whose `oracle_epoch` is up to this many
/// seconds *ahead* of `now` before rejecting as future-dated.
pub const ORACLE_FUTURE_SKEW_SECS: u64 = 30;

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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BorrowReceipt {
    pub account: Address,
    pub proof_id: BytesN<32>,
    pub market: Symbol,
    pub borrow_symbol: Symbol,
    pub collateral_symbol: Symbol,
    pub confirmed_at: u64,
}

/// Static metadata for a market pair. Registered by the admin at
/// deploy time or via `register_market`. Amount thresholds and rate
/// curves stay off-chain until interest accrual lands.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketMeta {
    pub key: Symbol,
    pub borrow_symbol: Symbol,
    pub collateral_symbol: Symbol,
}

#[contracttype]
enum DataKey {
    Admin,
    Markets,
    Position(Address, BytesN<32>),
    PositionsByAccount(Address),
    ProofUsed(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    IntentExpired = 1,
    ProofReplayed = 2,
    Reserved3 = 3,
    StaleOracle = 4,
    InvalidProof = 5,
    Unauthorized = 6,
    AlreadyInitialized = 7,
    NotInitialized = 8,
    MarketExists = 9,
    PositionNotFound = 10,
}

const BORROW_EVENT: Symbol = symbol_short!("borrow");
const REPAY_EVENT: Symbol = symbol_short!("repay");

#[contract]
pub struct BorrowPool;

#[contractimpl]
impl BorrowPool {
    /// One-shot init. Admin is the only principal allowed to register
    /// markets. Deploy scripts call this immediately after upload.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        let storage = env.storage().instance();
        if storage.has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        storage.set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Admin-gated. Appends `market` to the registry — no-op if a
    /// market with the same `key` already exists.
    pub fn register_market(env: Env, market: MarketMeta) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();

        let storage = env.storage().instance();
        let mut markets: Vec<MarketMeta> =
            storage.get(&DataKey::Markets).unwrap_or_else(|| Vec::new(&env));

        for existing in markets.iter() {
            if existing.key == market.key {
                return Err(Error::MarketExists);
            }
        }

        markets.push_back(market);
        storage.set(&DataKey::Markets, &markets);
        Ok(())
    }

    pub fn list_markets(env: Env) -> Vec<MarketMeta> {
        env.storage()
            .instance()
            .get(&DataKey::Markets)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

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

        // Oracle freshness: accept a small forward skew for browser
        // clock drift, and up to MAX_ORACLE_AGE_SECS in the past.
        let too_far_ahead = proof.oracle_epoch > now
            && proof.oracle_epoch - now > ORACLE_FUTURE_SKEW_SECS;
        let too_far_behind = proof.oracle_epoch < now
            && now - proof.oracle_epoch > MAX_ORACLE_AGE_SECS;
        if too_far_ahead || too_far_behind {
            return Err(Error::StaleOracle);
        }

        // Groth16 verify. Public signals order matches the circuit's
        // public inputs (account, market, proof_id, collateral_symbol,
        // borrow_symbol, hf_min_bps, max_ltv_bps, oracle_epoch) followed
        // by the public output (oracle_price_commitment). Amounts moved
        // to private witness for Phase-1 privacy.
        if !verifier::verify_groth16(
            &env,
            proof.a.clone(),
            proof.b.clone(),
            proof.c.clone(),
            proof.public_signals.clone(),
        ) {
            return Err(Error::InvalidProof);
        }

        let storage = env.storage().persistent();
        let proof_key = DataKey::ProofUsed(intent.proof_id.clone());
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

        // Position now keyed by (account, proof_id) so each borrow
        // gets its own storage slot instead of overwriting the prior
        // receipt.
        storage.set(
            &DataKey::Position(intent.account.clone(), intent.proof_id.clone()),
            &receipt,
        );

        // Append proof_id to the per-account index so
        // `positions_by_account` can enumerate without scanning storage.
        let index_key = DataKey::PositionsByAccount(intent.account.clone());
        let mut index: Vec<BytesN<32>> = storage
            .get(&index_key)
            .unwrap_or_else(|| Vec::new(&env));
        index.push_back(intent.proof_id.clone());
        storage.set(&index_key, &index);

        env.events().publish((BORROW_EVENT,), receipt.clone());

        Ok(receipt)
    }

    /// Latest receipt for `account`. Returns the most recent entry
    /// from the per-account index; `None` if the account has never
    /// borrowed. Kept for back-compat with the drawer's single-slot
    /// path — new consumers should call `positions_by_account`.
    pub fn position(env: Env, account: Address) -> Option<BorrowReceipt> {
        let storage = env.storage().persistent();
        let index: Vec<BytesN<32>> = storage
            .get(&DataKey::PositionsByAccount(account.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        let last = index.get(index.len().checked_sub(1)?)?;
        storage.get(&DataKey::Position(account, last))
    }

    pub fn positions_by_account(env: Env, account: Address) -> Vec<BorrowReceipt> {
        let storage = env.storage().persistent();
        let index: Vec<BytesN<32>> = storage
            .get(&DataKey::PositionsByAccount(account.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut out: Vec<BorrowReceipt> = Vec::new(&env);
        for proof_id in index.iter() {
            if let Some(receipt) =
                storage.get::<_, BorrowReceipt>(&DataKey::Position(account.clone(), proof_id))
            {
                out.push_back(receipt);
            }
        }
        out
    }

    /// Close a borrow position. Owner-authed; deletes the receipt and
    /// drops the proof_id from the per-account index. Real production
    /// would settle the actual debt + collateral movement here; this
    /// skeleton just retires the on-chain record.
    ///
    /// Returns the closed receipt so callers get audit info.
    pub fn repay(
        env: Env,
        account: Address,
        proof_id: BytesN<32>,
    ) -> Result<BorrowReceipt, Error> {
        account.require_auth();

        let storage = env.storage().persistent();
        let position_key = DataKey::Position(account.clone(), proof_id.clone());
        let receipt: BorrowReceipt =
            storage.get(&position_key).ok_or(Error::PositionNotFound)?;

        storage.remove(&position_key);

        let index_key = DataKey::PositionsByAccount(account.clone());
        let index: Vec<BytesN<32>> = storage
            .get(&index_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut next_index: Vec<BytesN<32>> = Vec::new(&env);
        for existing in index.iter() {
            if existing != proof_id {
                next_index.push_back(existing);
            }
        }

        if next_index.is_empty() {
            storage.remove(&index_key);
        } else {
            storage.set(&index_key, &next_index);
        }

        env.events().publish((REPAY_EVENT,), receipt.clone());

        Ok(receipt)
    }
}

impl BorrowPool {
    fn require_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }
}
