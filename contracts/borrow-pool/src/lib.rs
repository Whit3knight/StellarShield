#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    symbol_short, Address, BytesN, Env, Symbol, Vec,
};

mod borrow_verifier;
mod deposit_verifier;
mod merkle;
mod notes;
mod poseidon;
mod poseidon_constants;
mod rate;
mod state;
mod tokens;
mod verifier;
mod withdraw_verifier;

use state::{RateParams, RiskParams};

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
    DenominationMismatch = 11,
    AssetUnknown = 12,
    TreeCapacityExceeded = 13,
}

const BORROW_EVENT: Symbol = symbol_short!("borrow");
const REPAY_EVENT: Symbol = symbol_short!("repay");
const DEPOSIT_EVENT: Symbol = symbol_short!("deposit");
const WITHDRAW_EVENT: Symbol = symbol_short!("withdraw");

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

    /// Admin-gated in-place upgrade. Replaces the contract's WASM with
    /// `wasm_hash` (already uploaded via `stellar contract install`).
    /// Keeps contract address + persistent state intact so the frontend
    /// contract id and all live positions survive across code changes.
    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        env.deployer().update_current_contract_wasm(wasm_hash);
        Ok(())
    }

    /// Admin-gated ownership transfer. New admin takes over
    /// `register_market` + `upgrade` rights.
    pub fn admin_transfer(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    // -----------------------------------------------------------------
    // Shielded pool (Phase 2) — admin config
    //
    // The following endpoints set up the state required for shielded
    // deposit / borrow / repay / withdraw / liquidate. Each is
    // admin-gated. `initialize_shielded` is idempotent per-field so a
    // partial upgrade can top up missing pieces without redeploying.

    pub fn initialize_shielded(
        env: Env,
        reflector: Address,
        rate: RateParams,
        risk: RiskParams,
    ) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        state::set_reflector(&env, &reflector);
        state::set_rate_params(&env, &rate);
        state::set_risk_params(&env, &risk);
        Ok(())
    }

    pub fn set_reserve(env: Env, asset: Symbol, token_contract: Address) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        tokens::set_reserve(&env, &asset, &token_contract);
        Ok(())
    }

    pub fn set_rate_params(env: Env, params: RateParams) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        state::set_rate_params(&env, &params);
        Ok(())
    }

    pub fn set_risk_params(env: Env, params: RiskParams) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        state::set_risk_params(&env, &params);
        Ok(())
    }

    // -----------------------------------------------------------------
    // Shielded pool — view fns

    pub fn rate_params(env: Env) -> Option<RateParams> {
        state::rate_params(&env)
    }

    pub fn risk_params(env: Env) -> Option<RiskParams> {
        state::risk_params(&env)
    }

    pub fn reflector_contract(env: Env) -> Option<Address> {
        state::reflector(&env)
    }

    pub fn reserve_of(env: Env, asset: Symbol) -> Option<Address> {
        tokens::reserve(&env, &asset)
    }

    pub fn deposit_root(env: Env, asset: Symbol) -> Option<BytesN<32>> {
        state::deposit_root(&env, &asset)
    }

    pub fn loan_root(env: Env, asset: Symbol) -> Option<BytesN<32>> {
        state::loan_root(&env, &asset)
    }

    pub fn deposit_next_index(env: Env, asset: Symbol) -> u64 {
        state::deposit_next_index(&env, &asset)
    }

    pub fn loan_next_index(env: Env, asset: Symbol) -> u64 {
        state::loan_next_index(&env, &asset)
    }

    pub fn total_deposit(env: Env, asset: Symbol) -> u128 {
        state::total_deposit(&env, &asset)
    }

    pub fn total_borrow(env: Env, asset: Symbol) -> u128 {
        state::total_borrow(&env, &asset)
    }

    pub fn borrow_index(env: Env, asset: Symbol) -> state::IndexSnapshot {
        rate::accrue_borrow_index(&env, &asset)
    }

    pub fn liquidity_index(env: Env, asset: Symbol) -> state::IndexSnapshot {
        rate::accrue_liquidity_index(&env, &asset)
    }

    // -----------------------------------------------------------------
    // Shielded pool — user-facing operations
    //
    // `deposit_shielded` accepts a Groth16 proof that the caller knows
    // sk + salt for the declared commitment. Contract additionally
    // asserts the transferred amount matches the fixed denomination
    // per asset — a bug here lets an attacker mint a commitment
    // claiming more collateral than they parked in the pool.

    pub fn deposit_shielded(
        env: Env,
        from: Address,
        asset: Symbol,
        proof: BorrowProof,
        memo: soroban_sdk::Bytes,
    ) -> Result<u64, Error> {
        from.require_auth();

        // Deposit circuit publishes [amount, asset_tag, commitment].
        if proof.public_signals.len() != 3 {
            return Err(Error::InvalidProof);
        }
        let amount_fr = proof.public_signals.get(0).unwrap();
        let asset_tag_fr = proof.public_signals.get(1).unwrap();
        let commitment_fr = proof.public_signals.get(2).unwrap();

        // The circuit constrains `commitment == Poseidon(amount, asset_tag, sk, salt)`.
        // Contract must additionally check the token movement matches
        // the declared amount + asset before accepting.
        let expected_tag = notes::asset_tag(&env, &asset).ok_or(Error::AssetUnknown)?;
        let declared_tag = fr_to_u32(&asset_tag_fr);
        if declared_tag != expected_tag {
            return Err(Error::DenominationMismatch);
        }
        let denomination =
            notes::denomination(&env, &asset).ok_or(Error::AssetUnknown)?;
        let declared_amount = fr_to_i128(&amount_fr);
        if declared_amount != denomination {
            return Err(Error::DenominationMismatch);
        }

        if !deposit_verifier::verify_groth16(
            &env,
            proof.a.clone(),
            proof.b.clone(),
            proof.c.clone(),
            proof.public_signals.clone(),
        ) {
            return Err(Error::InvalidProof);
        }

        // Pull collateral into the contract.
        tokens::transfer_in(&env, &asset, &from, denomination);

        // Append commitment to the deposit tree for `asset` and persist
        // the new frontier + root.
        let next_index = state::deposit_next_index(&env, &asset);
        let capacity = 1u64 << (merkle::DEPTH as u64);
        if next_index >= capacity {
            return Err(Error::TreeCapacityExceeded);
        }

        let mut frontier_arr = load_frontier(&env, state::deposit_frontier(&env, &asset));
        let leaf = commitment_fr.clone();
        let new_root = merkle::append(&env, &leaf, &mut frontier_arr, next_index);

        state::set_deposit_frontier(&env, &asset, &frontier_to_vec(&env, &frontier_arr));
        state::set_deposit_root(&env, &asset, &new_root.to_bytes());
        state::set_deposit_next_index(&env, &asset, next_index + 1);
        state::set_total_deposit(
            &env,
            &asset,
            state::total_deposit(&env, &asset).saturating_add(1),
        );

        // Publish `(index, commitment, memo)` so any client can
        // reconstruct the tree from events without contract storage
        // reads. Commitment is public (a Poseidon output that leaks
        // nothing about amount/sk/salt); memo remains encrypted for
        // the recipient only.
        env.events().publish(
            (DEPOSIT_EVENT, asset.clone()),
            (next_index, new_root.to_bytes(), leaf.to_bytes(), memo),
        );
        Ok(next_index)
    }

    /// Burn one deposit note via zk proof, release the fixed
    /// denomination to `to`. Prover shows Merkle inclusion at the
    /// current deposit_root plus a valid nullifier so the contract
    /// can block reuse.
    ///
    /// Public signals order: [asset_tag, denomination, deposit_root,
    /// nullifier].
    pub fn withdraw_shielded(
        env: Env,
        to: Address,
        asset: Symbol,
        proof: BorrowProof,
    ) -> Result<(), Error> {
        to.require_auth();

        if proof.public_signals.len() != 4 {
            return Err(Error::InvalidProof);
        }
        let asset_tag_fr = proof.public_signals.get(0).unwrap();
        let denomination_fr = proof.public_signals.get(1).unwrap();
        let deposit_root_fr = proof.public_signals.get(2).unwrap();
        let nullifier_fr = proof.public_signals.get(3).unwrap();

        let expected_tag =
            notes::asset_tag(&env, &asset).ok_or(Error::AssetUnknown)?;
        if fr_to_u32(&asset_tag_fr) != expected_tag {
            return Err(Error::DenominationMismatch);
        }
        let denomination =
            notes::denomination(&env, &asset).ok_or(Error::AssetUnknown)?;
        if fr_to_i128(&denomination_fr) != denomination {
            return Err(Error::DenominationMismatch);
        }

        // Contract's stored deposit root must match the value the
        // prover attests to. If they diverge the leaf either doesn't
        // exist or lives in an older tree state.
        let stored_root =
            state::deposit_root(&env, &asset).ok_or(Error::InvalidProof)?;
        if stored_root != deposit_root_fr.to_bytes() {
            return Err(Error::InvalidProof);
        }

        let nullifier_bytes = nullifier_fr.to_bytes();
        if state::nullifier_used(&env, &nullifier_bytes) {
            return Err(Error::ProofReplayed);
        }

        if !withdraw_verifier::verify_groth16(
            &env,
            proof.a.clone(),
            proof.b.clone(),
            proof.c.clone(),
            proof.public_signals.clone(),
        ) {
            return Err(Error::InvalidProof);
        }

        state::mark_nullifier_used(&env, &nullifier_bytes);

        // Release tokens back to the caller.
        tokens::transfer_out(&env, &asset, &to, denomination);

        // Aggregate accounting: one fewer active deposit note.
        state::set_total_deposit(
            &env,
            &asset,
            state::total_deposit(&env, &asset).saturating_sub(1),
        );

        env.events().publish(
            (WITHDRAW_EVENT, asset.clone()),
            (nullifier_bytes.clone(), to.clone()),
        );
        Ok(())
    }

    /// Shielded borrow. Consumes N=4 collateral notes via nullifiers,
    /// appends a new loan-note commitment to the loan tree, emits an
    /// encrypted memo attaching the note metadata for the borrower.
    ///
    /// Public signals order (must match the borrow circuit):
    ///   [0]     borrow_amount
    ///   [1]     borrow_asset_tag
    ///   [2]     collateral_asset_tag
    ///   [3]     hf_min_bps
    ///   [4]     max_ltv_bps
    ///   [5]     deposit_root
    ///   [6]     borrow_commitment
    ///   [7..11] nullifiers[0..4]
    pub fn borrow_shielded(
        env: Env,
        from: Address,
        collateral_asset: Symbol,
        borrow_asset: Symbol,
        proof: BorrowProof,
        memo: soroban_sdk::Bytes,
    ) -> Result<u64, Error> {
        from.require_auth();

        if proof.public_signals.len() != 11 {
            return Err(Error::InvalidProof);
        }
        let borrow_amount_fr = proof.public_signals.get(0).unwrap();
        let borrow_tag_fr = proof.public_signals.get(1).unwrap();
        let collateral_tag_fr = proof.public_signals.get(2).unwrap();
        let hf_min_fr = proof.public_signals.get(3).unwrap();
        let max_ltv_fr = proof.public_signals.get(4).unwrap();
        let deposit_root_fr = proof.public_signals.get(5).unwrap();
        let borrow_commit_fr = proof.public_signals.get(6).unwrap();

        // Asset + risk parameter cross-check. Contract's stored risk
        // params dictate what the proof MUST have used; the circuit
        // treats them as public inputs so the caller can't manufacture
        // a friendlier LTV.
        let expected_borrow_tag =
            notes::asset_tag(&env, &borrow_asset).ok_or(Error::AssetUnknown)?;
        let expected_collateral_tag = notes::asset_tag(&env, &collateral_asset)
            .ok_or(Error::AssetUnknown)?;
        if fr_to_u32(&borrow_tag_fr) != expected_borrow_tag {
            return Err(Error::DenominationMismatch);
        }
        if fr_to_u32(&collateral_tag_fr) != expected_collateral_tag {
            return Err(Error::DenominationMismatch);
        }

        let risk = state::risk_params(&env).ok_or(Error::NotInitialized)?;
        if fr_to_u32(&hf_min_fr) != risk.hf_min_bps {
            return Err(Error::InvalidProof);
        }
        if fr_to_u32(&max_ltv_fr) != risk.max_ltv_bps {
            return Err(Error::InvalidProof);
        }

        // Deposit root sanity: must match the current on-chain state.
        let stored_root = state::deposit_root(&env, &collateral_asset)
            .ok_or(Error::InvalidProof)?;
        if stored_root != deposit_root_fr.to_bytes() {
            return Err(Error::InvalidProof);
        }

        // Nullifier freshness: all four must be unused.
        let mut nullifier_bytes: [soroban_sdk::BytesN<32>; 4] = [
            proof.public_signals.get(7).unwrap().to_bytes(),
            proof.public_signals.get(8).unwrap().to_bytes(),
            proof.public_signals.get(9).unwrap().to_bytes(),
            proof.public_signals.get(10).unwrap().to_bytes(),
        ];
        for null in nullifier_bytes.iter() {
            if state::nullifier_used(&env, null) {
                return Err(Error::ProofReplayed);
            }
        }
        // Reject duplicate nullifiers within the same proof — the
        // circuit doesn't range-check indices, so a prover could try
        // to double-spend one note across two of the four slots.
        for i in 0..nullifier_bytes.len() {
            for j in (i + 1)..nullifier_bytes.len() {
                if nullifier_bytes[i] == nullifier_bytes[j] {
                    return Err(Error::ProofReplayed);
                }
            }
        }

        if !borrow_verifier::verify_groth16(
            &env,
            proof.a.clone(),
            proof.b.clone(),
            proof.c.clone(),
            proof.public_signals.clone(),
        ) {
            return Err(Error::InvalidProof);
        }

        for null in nullifier_bytes.iter_mut() {
            state::mark_nullifier_used(&env, null);
        }

        // Append the new loan-note commitment to the loan tree for
        // `borrow_asset` and persist the updated frontier + root.
        let next_index = state::loan_next_index(&env, &borrow_asset);
        let capacity = 1u64 << (merkle::DEPTH as u64);
        if next_index >= capacity {
            return Err(Error::TreeCapacityExceeded);
        }

        let mut frontier_arr =
            load_frontier(&env, state::loan_frontier(&env, &borrow_asset));
        let leaf = borrow_commit_fr.clone();
        let new_root = merkle::append(&env, &leaf, &mut frontier_arr, next_index);

        state::set_loan_frontier(&env, &borrow_asset, &frontier_to_vec(&env, &frontier_arr));
        state::set_loan_root(&env, &borrow_asset, &new_root.to_bytes());
        state::set_loan_next_index(&env, &borrow_asset, next_index + 1);

        // Aggregate accounting.
        state::set_total_deposit(
            &env,
            &collateral_asset,
            state::total_deposit(&env, &collateral_asset).saturating_sub(4),
        );
        state::set_total_borrow(
            &env,
            &borrow_asset,
            state::total_borrow(&env, &borrow_asset).saturating_add(1),
        );
        rate::accrue_borrow_index(&env, &borrow_asset);

        let borrow_amount_native = fr_to_i128(&borrow_amount_fr);
        // Silence unused-var lint until the borrow event carries this
        // downstream — right now it's redundant with what the memo
        // encrypts, and public amount would defeat the whole point.
        let _ = borrow_amount_native;

        env.events().publish(
            (BORROW_EVENT, collateral_asset.clone(), borrow_asset.clone()),
            (next_index, new_root.to_bytes(), leaf.to_bytes(), memo),
        );
        Ok(next_index)
    }
}

// -----------------------------------------------------------------
// Helpers

fn fr_to_i128(value: &Fr) -> i128 {
    let bytes = value.to_bytes();
    let raw: [u8; 32] = bytes.into();
    let mut low: u128 = 0;
    for byte in raw.iter().skip(16) {
        low = (low << 8) | (*byte as u128);
    }
    low as i128
}

fn fr_to_u32(value: &Fr) -> u32 {
    let bytes = value.to_bytes();
    let raw: [u8; 32] = bytes.into();
    ((raw[28] as u32) << 24)
        | ((raw[29] as u32) << 16)
        | ((raw[30] as u32) << 8)
        | (raw[31] as u32)
}

fn load_frontier(
    env: &Env,
    stored: Vec<BytesN<32>>,
) -> [Fr; merkle::DEPTH] {
    let mut out: [Fr; merkle::DEPTH] =
        core::array::from_fn(|_| Fr::from_bytes(BytesN::from_array(env, &[0u8; 32])));
    for i in 0..merkle::DEPTH {
        if let Some(bytes) = stored.get(i as u32) {
            out[i] = Fr::from_bytes(bytes);
        }
    }
    out
}

fn frontier_to_vec(env: &Env, frontier: &[Fr; merkle::DEPTH]) -> Vec<BytesN<32>> {
    let mut out = Vec::new(env);
    for entry in frontier.iter() {
        out.push_back(entry.to_bytes());
    }
    out
}

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
