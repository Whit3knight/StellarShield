#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    symbol_short, Address, BytesN, Env, Symbol, Vec,
};

mod borrow_verifier;
mod deposit_verifier;
mod deposit_quad_verifier;
mod liquidate_v2_verifier;
mod liquidate_verifier;
mod merkle;
mod merkle_zeros;
mod notes;
mod poseidon;
mod poseidon_constants;
mod rate;
mod repay_verifier;
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
const LIQUIDATE_EVENT: Symbol = symbol_short!("liquidat");

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

    /// Register (or rotate) the X25519 pubkey the liquidation service
    /// uses to decrypt borrow memos. Empty until an admin sets it; new
    /// borrows encrypt to borrower only in the meantime and stay
    /// non-liquidatable. See docs/liquidation-design.md.
    pub fn set_liquidation_service_pk(
        env: Env,
        pk: BytesN<32>,
    ) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        state::set_liquidation_service_pk(&env, &pk);
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

    pub fn liquidation_service_pk(env: Env) -> Option<BytesN<32>> {
        state::liquidation_service_pk(&env)
    }

    pub fn liquidation_bond(
        env: Env,
        loan_commitment: BytesN<32>,
    ) -> Option<state::LiquidationBond> {
        state::liquidation_bond(&env, &loan_commitment)
    }

    pub fn loan_nullifier(
        env: Env,
        loan_commitment: BytesN<32>,
    ) -> Option<BytesN<32>> {
        state::loan_nullifier(&env, &loan_commitment)
    }

    pub fn borrow_index_at_open(
        env: Env,
        loan_commitment: BytesN<32>,
    ) -> Option<u128> {
        state::borrow_index_at_open(&env, &loan_commitment)
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

    /// Merkle frontier for the deposit tree — the DEPTH-sized array of
    /// rightmost per-level hashes needed to compute a leaf's
    /// inclusion witness client-side. Exposed so clients can cache
    /// the witness at deposit time without depending on Soroban RPC
    /// event retention (which drops after ~24h).
    pub fn deposit_frontier(env: Env, asset: Symbol) -> Vec<BytesN<32>> {
        state::deposit_frontier(&env, &asset)
    }

    pub fn loan_frontier(env: Env, asset: Symbol) -> Vec<BytesN<32>> {
        state::loan_frontier(&env, &asset)
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

        // Deposit circuit publishes [commitment, amount, asset_tag] —
        // snarkjs puts the `commitment` output ahead of the public
        // inputs in declaration order.
        if proof.public_signals.len() != 3 {
            return Err(Error::InvalidProof);
        }
        let commitment_fr = proof.public_signals.get(0).unwrap();
        let amount_fr = proof.public_signals.get(1).unwrap();
        let asset_tag_fr = proof.public_signals.get(2).unwrap();

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

    /// Quad-deposit variant that ships FOUR leaves under one Groth16
    /// proof. Public signals order (snarkjs outputs first):
    ///   [0..3] commitment[0..3]
    ///   [4]    amount     (fixed denomination in whole units)
    ///   [5]    asset_tag  (0 = XLM, 1 = USDC, 2 = EURC)
    /// The circuit constrains each `commitment[i] == Poseidon(amount,
    /// asset_tag, sk, salt_i)` for a shared `sk`. One pairing check on
    /// chain covers all four, so the per-tx CPU budget only pays for
    /// verification once — an ordinary `deposit_shielded_batch` at N=4
    /// runs 4 verifies (~240M CPU) which trips the network's 100M cap.
    /// Contract still transfers the denomination four times and
    /// appends four leaves, so the caller pushes `4 * denomination`
    /// worth of the underlying token in one shot.
    pub fn deposit_shielded_quad(
        env: Env,
        from: Address,
        asset: Symbol,
        proof: BorrowProof,
        memos: Vec<soroban_sdk::Bytes>,
    ) -> Result<Vec<u64>, Error> {
        from.require_auth();

        if proof.public_signals.len() != 6 {
            return Err(Error::InvalidProof);
        }
        if memos.len() != 4 {
            return Err(Error::InvalidProof);
        }

        let expected_tag =
            notes::asset_tag(&env, &asset).ok_or(Error::AssetUnknown)?;
        let denomination =
            notes::denomination(&env, &asset).ok_or(Error::AssetUnknown)?;

        let asset_tag_fr = proof.public_signals.get(5).unwrap();
        if fr_to_u32(&asset_tag_fr) != expected_tag {
            return Err(Error::DenominationMismatch);
        }
        let amount_fr = proof.public_signals.get(4).unwrap();
        if fr_to_i128(&amount_fr) != denomination {
            return Err(Error::DenominationMismatch);
        }

        if !deposit_quad_verifier::verify_groth16(
            &env,
            proof.a.clone(),
            proof.b.clone(),
            proof.c.clone(),
            proof.public_signals.clone(),
        ) {
            return Err(Error::InvalidProof);
        }

        // Pull four notes' worth of collateral in one SAC call — each
        // `token::transfer` alone runs ~15M CPU on Soroban, so four
        // separate transfers plus the pairing check would trip the
        // 100M per-tx cap. Amount is bounded (denomination × 4).
        tokens::transfer_in(&env, &asset, &from, denomination * 4);

        let capacity = 1u64 << (merkle::DEPTH as u64);
        let mut frontier_arr =
            load_frontier(&env, state::deposit_frontier(&env, &asset));
        let mut next_index = state::deposit_next_index(&env, &asset);
        let total = state::total_deposit(&env, &asset);
        let mut indexes: Vec<u64> = Vec::new(&env);

        if next_index + 4 > capacity {
            return Err(Error::TreeCapacityExceeded);
        }

        let leaf0 = proof.public_signals.get(0).unwrap();
        let leaf1 = proof.public_signals.get(1).unwrap();
        let leaf2 = proof.public_signals.get(2).unwrap();
        let leaf3 = proof.public_signals.get(3).unwrap();

        let new_root = if next_index & 0b11 == 0 {
            // 4-aligned append — 21 Poseidon hashes total (subtree of
            // 3 + walk-up of DEPTH-2) versus 4× DEPTH = 80 that four
            // singleton `merkle::append` calls would run.
            merkle::append_four_aligned(
                &env,
                &[
                    leaf0.clone(),
                    leaf1.clone(),
                    leaf2.clone(),
                    leaf3.clone(),
                ],
                &mut frontier_arr,
                next_index,
            )
        } else {
            // Rare unaligned path (should only hit if a caller mixes
            // singleton + quad deposits mid-tree). Falls back to per-
            // leaf appends.
            let mut root = merkle::append(&env, &leaf0, &mut frontier_arr, next_index);
            root = merkle::append(&env, &leaf1, &mut frontier_arr, next_index + 1);
            root = merkle::append(&env, &leaf2, &mut frontier_arr, next_index + 2);
            root = merkle::append(&env, &leaf3, &mut frontier_arr, next_index + 3);
            root
        };
        let new_root_bytes = new_root.to_bytes();

        // Emit one event per leaf so the client's scanner and the
        // event-replay witness rebuild both keep working unchanged.
        for i in 0u32..4 {
            let leaf_fr = proof.public_signals.get(i).unwrap();
            env.events().publish(
                (DEPOSIT_EVENT, asset.clone()),
                (
                    next_index + (i as u64),
                    new_root_bytes.clone(),
                    leaf_fr.to_bytes(),
                    memos.get(i).unwrap().clone(),
                ),
            );
            indexes.push_back(next_index + (i as u64));
        }
        next_index += 4;

        state::set_deposit_frontier(
            &env,
            &asset,
            &frontier_to_vec(&env, &frontier_arr),
        );
        state::set_deposit_root(&env, &asset, &new_root_bytes);
        state::set_deposit_next_index(&env, &asset, next_index);
        state::set_total_deposit(&env, &asset, total.saturating_add(4));

        Ok(indexes)
    }

    /// Batched `deposit_shielded`. `proofs[i]` mints the leaf described
    /// by `memos[i]`; the pair length must match. Signed once at the
    /// caller (single `from.require_auth()`), so the wallet UX only
    /// prompts once for a full round of shielded collateral instead of
    /// N separate deposits. Returns the assigned leaf indexes in the
    /// same order the proofs came in.
    pub fn deposit_shielded_batch(
        env: Env,
        from: Address,
        asset: Symbol,
        proofs: Vec<BorrowProof>,
        memos: Vec<soroban_sdk::Bytes>,
    ) -> Result<Vec<u64>, Error> {
        from.require_auth();

        if proofs.len() != memos.len() {
            return Err(Error::InvalidProof);
        }
        if proofs.is_empty() {
            return Err(Error::InvalidProof);
        }

        let expected_tag =
            notes::asset_tag(&env, &asset).ok_or(Error::AssetUnknown)?;
        let denomination =
            notes::denomination(&env, &asset).ok_or(Error::AssetUnknown)?;
        let capacity = 1u64 << (merkle::DEPTH as u64);

        // Load the frontier ONCE, mutate in place across every leaf so
        // storage-write cost stays proportional to N instead of N * DEPTH.
        let mut frontier_arr =
            load_frontier(&env, state::deposit_frontier(&env, &asset));
        let mut next_index = state::deposit_next_index(&env, &asset);
        let mut total = state::total_deposit(&env, &asset);
        let mut last_root_bytes: Option<BytesN<32>> = None;
        let mut indexes: Vec<u64> = Vec::new(&env);

        for i in 0..proofs.len() {
            let proof = proofs.get(i).unwrap();
            let memo = memos.get(i).unwrap();

            if proof.public_signals.len() != 3 {
                return Err(Error::InvalidProof);
            }
            let commitment_fr = proof.public_signals.get(0).unwrap();
            let amount_fr = proof.public_signals.get(1).unwrap();
            let asset_tag_fr = proof.public_signals.get(2).unwrap();

            if fr_to_u32(&asset_tag_fr) != expected_tag {
                return Err(Error::DenominationMismatch);
            }
            if fr_to_i128(&amount_fr) != denomination {
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

            tokens::transfer_in(&env, &asset, &from, denomination);

            if next_index >= capacity {
                return Err(Error::TreeCapacityExceeded);
            }
            let leaf = commitment_fr.clone();
            let new_root =
                merkle::append(&env, &leaf, &mut frontier_arr, next_index);
            let new_root_bytes = new_root.to_bytes();

            env.events().publish(
                (DEPOSIT_EVENT, asset.clone()),
                (
                    next_index,
                    new_root_bytes.clone(),
                    leaf.to_bytes(),
                    memo.clone(),
                ),
            );
            indexes.push_back(next_index);
            last_root_bytes = Some(new_root_bytes);
            next_index += 1;
            total = total.saturating_add(1);
        }

        state::set_deposit_frontier(
            &env,
            &asset,
            &frontier_to_vec(&env, &frontier_arr),
        );
        if let Some(root_bytes) = last_root_bytes {
            state::set_deposit_root(&env, &asset, &root_bytes);
        }
        state::set_deposit_next_index(&env, &asset, next_index);
        state::set_total_deposit(&env, &asset, total);

        Ok(indexes)
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

        if proof.public_signals.len() != 15 {
            return Err(Error::InvalidProof);
        }
        let borrow_amount_fr = proof.public_signals.get(0).unwrap();
        let borrow_tag_fr = proof.public_signals.get(1).unwrap();
        let collateral_tag_fr = proof.public_signals.get(2).unwrap();
        let hf_min_fr = proof.public_signals.get(3).unwrap();
        let max_ltv_fr = proof.public_signals.get(4).unwrap();
        let deposit_root_fr = proof.public_signals.get(5).unwrap();
        let borrow_commit_fr = proof.public_signals.get(6).unwrap();
        let borrow_amount_commit_fr = proof.public_signals.get(11).unwrap();
        let collateral_value_commit_fr = proof.public_signals.get(12).unwrap();
        let borrow_price_commit_fr = proof.public_signals.get(13).unwrap();
        let loan_nullifier_fr = proof.public_signals.get(14).unwrap();

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

        // Track L: pin the bond keyed by the loan commitment. Absent
        // bond → non-liquidatable (grandfathered). Present bond → a
        // liquidator with memo openings can prove the position is
        // underwater without ever learning the borrower's identity.
        let bond = state::LiquidationBond {
            borrow_amount_commit: borrow_amount_commit_fr.to_bytes(),
            collateral_value_commit: collateral_value_commit_fr.to_bytes(),
            borrow_price_commit: borrow_price_commit_fr.to_bytes(),
            borrow_asset_tag: expected_borrow_tag,
            collateral_asset_tag: expected_collateral_tag,
            oracle_epoch: proof.oracle_epoch,
            opened_at: env.ledger().timestamp(),
        };
        state::set_liquidation_bond(&env, &leaf.to_bytes(), &bond);
        // Track A: pre-published loan_nullifier so a service worker
        // can trigger liquidation without borrower sk. Circuit binds
        // `Poseidon(sk, borrow_commitment) === loan_nullifier`; here
        // we cache the value keyed by the loan commitment for O(1)
        // liquidate-time lookup.
        state::set_loan_nullifier(&env, &leaf.to_bytes(), &loan_nullifier_fr.to_bytes());
        // Track D: snapshot the accrued borrow_index so repay can
        // charge `loan_amount * index_now / index_at_open`. Read the
        // accrued value AFTER `rate::accrue_borrow_index` above wound
        // the accumulator forward to now.
        let index_now = state::borrow_index(&env, &borrow_asset).value;
        state::set_borrow_index_at_open(&env, &leaf.to_bytes(), index_now);

        env.events().publish(
            (BORROW_EVENT, collateral_asset.clone(), borrow_asset.clone()),
            (next_index, new_root.to_bytes(), leaf.to_bytes(), memo),
        );
        Ok(next_index)
    }

    /// Loan-tree variant of withdraw. Same Groth16 circuit as the
    /// deposit-side withdraw, but the contract checks the caller's
    /// declared `amount` against the loan tree's root instead of the
    /// fixed deposit denomination. Payout size is variable (whatever
    /// the borrow proof committed to), so this DOES leak the loan
    /// amount publicly on Horizon — accepted trade-off for MVP: chain
    /// observer sees an unlinkable withdrawal of amount X, no wallet
    /// linkage to any specific borrow tx.
    ///
    /// Public signals order (same as withdraw_shielded):
    ///   [0] asset_tag
    ///   [1] amount           (borrow amount minted by borrow_shielded)
    ///   [2] loan_root
    ///   [3] nullifier
    pub fn withdraw_loan_shielded(
        env: Env,
        to: Address,
        asset: Symbol,
        proof: BorrowProof,
    ) -> Result<i128, Error> {
        to.require_auth();

        if proof.public_signals.len() != 4 {
            return Err(Error::InvalidProof);
        }
        let asset_tag_fr = proof.public_signals.get(0).unwrap();
        let amount_fr = proof.public_signals.get(1).unwrap();
        let loan_root_fr = proof.public_signals.get(2).unwrap();
        let nullifier_fr = proof.public_signals.get(3).unwrap();

        let expected_tag =
            notes::asset_tag(&env, &asset).ok_or(Error::AssetUnknown)?;
        if fr_to_u32(&asset_tag_fr) != expected_tag {
            return Err(Error::DenominationMismatch);
        }

        let amount = fr_to_i128(&amount_fr);
        if amount <= 0 {
            return Err(Error::InvalidProof);
        }

        let stored_root =
            state::loan_root(&env, &asset).ok_or(Error::InvalidProof)?;
        if stored_root != loan_root_fr.to_bytes() {
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

        tokens::transfer_out(&env, &asset, &to, amount);

        state::set_total_borrow(
            &env,
            &asset,
            state::total_borrow(&env, &asset).saturating_sub(1),
        );

        env.events().publish(
            (WITHDRAW_EVENT, asset.clone(), Symbol::new(&env, "loan")),
            (nullifier_bytes.clone(), to.clone(), amount),
        );
        Ok(amount)
    }

    /// Shielded repay. Burns one loan note + one same-asset deposit
    /// note. Circuit enforces
    ///   `deposit_amount * borrow_index_snapshot >=
    ///    loan_amount    * borrow_index_now`
    /// so the pool is made whole for the accrued debt. Both
    /// nullifiers marked used, aggregate borrow + deposit counters
    /// decremented. No public transfer.
    ///
    /// Public signals:
    ///   [0] asset_tag
    ///   [1] loan_root
    ///   [2] deposit_root
    ///   [3] loan_nullifier
    ///   [4] deposit_nullifier
    ///   [5] borrow_index_snapshot    (Track D)
    ///   [6] borrow_index_now         (Track D)
    ///
    /// `loan_commitment` comes in as a tx arg so the contract can
    /// look up the BorrowIndexAtOpen sidecar; pre-D loans without
    /// the sidecar are grandfathered as zero-interest by treating
    /// `snapshot = index_now` (the ratio collapses to 1.0).
    pub fn repay_shielded(
        env: Env,
        from: Address,
        asset: Symbol,
        loan_commitment: BytesN<32>,
        proof: BorrowProof,
    ) -> Result<(), Error> {
        from.require_auth();

        if proof.public_signals.len() != 7 {
            return Err(Error::InvalidProof);
        }
        let asset_tag_fr = proof.public_signals.get(0).unwrap();
        let loan_root_fr = proof.public_signals.get(1).unwrap();
        let deposit_root_fr = proof.public_signals.get(2).unwrap();
        let loan_nul_fr = proof.public_signals.get(3).unwrap();
        let dep_nul_fr = proof.public_signals.get(4).unwrap();
        let index_snapshot_fr = proof.public_signals.get(5).unwrap();
        let index_now_fr = proof.public_signals.get(6).unwrap();

        let expected_tag =
            notes::asset_tag(&env, &asset).ok_or(Error::AssetUnknown)?;
        if fr_to_u32(&asset_tag_fr) != expected_tag {
            return Err(Error::DenominationMismatch);
        }

        let stored_loan_root =
            state::loan_root(&env, &asset).ok_or(Error::InvalidProof)?;
        if stored_loan_root != loan_root_fr.to_bytes() {
            return Err(Error::InvalidProof);
        }
        let stored_dep_root =
            state::deposit_root(&env, &asset).ok_or(Error::InvalidProof)?;
        if stored_dep_root != deposit_root_fr.to_bytes() {
            return Err(Error::InvalidProof);
        }

        let loan_nul_bytes = loan_nul_fr.to_bytes();
        let dep_nul_bytes = dep_nul_fr.to_bytes();
        if state::nullifier_used(&env, &loan_nul_bytes)
            || state::nullifier_used(&env, &dep_nul_bytes)
        {
            return Err(Error::ProofReplayed);
        }
        if loan_nul_bytes == dep_nul_bytes {
            return Err(Error::InvalidProof);
        }

        // Track D: accrue the borrow_index to now, then cross-check
        // the circuit's public signals match what the contract sees.
        // Grandfather pre-D loans: an absent sidecar collapses the
        // ratio to 1.0 by treating snapshot as index_now.
        let index_now_snapshot = rate::accrue_borrow_index(&env, &asset);
        let index_now = index_now_snapshot.value;
        let index_snapshot = state::borrow_index_at_open(&env, &loan_commitment)
            .unwrap_or(index_now);
        if fr_to_u128(&index_snapshot_fr) != index_snapshot {
            return Err(Error::InvalidProof);
        }
        if fr_to_u128(&index_now_fr) != index_now {
            return Err(Error::InvalidProof);
        }

        if !repay_verifier::verify_groth16(
            &env,
            proof.a.clone(),
            proof.b.clone(),
            proof.c.clone(),
            proof.public_signals.clone(),
        ) {
            return Err(Error::InvalidProof);
        }

        state::mark_nullifier_used(&env, &loan_nul_bytes);
        state::mark_nullifier_used(&env, &dep_nul_bytes);

        state::set_total_borrow(
            &env,
            &asset,
            state::total_borrow(&env, &asset).saturating_sub(1),
        );
        state::set_total_deposit(
            &env,
            &asset,
            state::total_deposit(&env, &asset).saturating_sub(1),
        );

        env.events().publish(
            (REPAY_EVENT, asset.clone()),
            (loan_nul_bytes, dep_nul_bytes, from.clone()),
        );
        Ok(())
    }

    /// Shielded liquidation (v1). Permissionless — any caller who
    /// holds the memo openings for an underwater loan can burn its
    /// nullifier via the sk-binding liquidate circuit. Contract
    /// cross-checks the 3 bond commitments in the proof match the
    /// stored `LiquidationBond` and enforces the risk-params
    /// threshold. Bounty payout (Track C-simple) mints a fresh
    /// denomination note to the liquidator via the caller-supplied
    /// commitment; see the append + DEPOSIT_EVENT below.
    /// Post-Track-A bonds route through `liquidate_shielded_v2`
    /// (no sk in the circuit); this fn stays as the grandfathered
    /// path for pre-A loans. See docs/liquidation-design.md.
    ///
    /// Public signals:
    ///   [0] loan_commitment
    ///   [1] borrow_amount_commit
    ///   [2] collateral_value_commit
    ///   [3] borrow_price_commit
    ///   [4] current_price
    ///   [5] threshold_bps
    ///   [6] loan_nullifier
    pub fn liquidate_shielded(
        env: Env,
        liquidator: Address,
        borrow_asset: Symbol,
        collateral_asset: Symbol,
        proof: BorrowProof,
        bounty_commit: BytesN<32>,
        bounty_memo: soroban_sdk::Bytes,
    ) -> Result<(), Error> {
        liquidator.require_auth();

        if proof.public_signals.len() != 7 {
            return Err(Error::InvalidProof);
        }
        let loan_commit_fr = proof.public_signals.get(0).unwrap();
        let borrow_amount_commit_fr = proof.public_signals.get(1).unwrap();
        let collateral_value_commit_fr = proof.public_signals.get(2).unwrap();
        let borrow_price_commit_fr = proof.public_signals.get(3).unwrap();
        let threshold_fr = proof.public_signals.get(5).unwrap();
        let nullifier_fr = proof.public_signals.get(6).unwrap();

        let loan_commit_bytes = loan_commit_fr.to_bytes();
        let bond = state::liquidation_bond(&env, &loan_commit_bytes)
            .ok_or(Error::InvalidProof)?;

        if bond.borrow_amount_commit != borrow_amount_commit_fr.to_bytes()
            || bond.collateral_value_commit != collateral_value_commit_fr.to_bytes()
            || bond.borrow_price_commit != borrow_price_commit_fr.to_bytes()
        {
            return Err(Error::InvalidProof);
        }

        let expected_borrow_tag =
            notes::asset_tag(&env, &borrow_asset).ok_or(Error::AssetUnknown)?;
        if bond.borrow_asset_tag != expected_borrow_tag {
            return Err(Error::DenominationMismatch);
        }
        let expected_collateral_tag =
            notes::asset_tag(&env, &collateral_asset).ok_or(Error::AssetUnknown)?;
        if bond.collateral_asset_tag != expected_collateral_tag {
            return Err(Error::DenominationMismatch);
        }

        let risk = state::risk_params(&env).ok_or(Error::NotInitialized)?;
        if fr_to_u32(&threshold_fr) != risk.liquidation_threshold_bps {
            return Err(Error::InvalidProof);
        }

        let now = env.ledger().timestamp();
        if proof.oracle_epoch + MAX_ORACLE_AGE_SECS < now {
            return Err(Error::StaleOracle);
        }
        if proof.oracle_epoch > now + ORACLE_FUTURE_SKEW_SECS {
            return Err(Error::StaleOracle);
        }

        let nullifier_bytes = nullifier_fr.to_bytes();
        if state::nullifier_used(&env, &nullifier_bytes) {
            return Err(Error::ProofReplayed);
        }

        if !liquidate_verifier::verify_groth16(
            &env,
            proof.a.clone(),
            proof.b.clone(),
            proof.c.clone(),
            proof.public_signals.clone(),
        ) {
            return Err(Error::InvalidProof);
        }

        state::mark_nullifier_used(&env, &nullifier_bytes);
        state::set_total_borrow(
            &env,
            &borrow_asset,
            state::total_borrow(&env, &borrow_asset).saturating_sub(1),
        );

        // C-simple bounty: append the liquidator-supplied commitment
        // to the collateral asset's deposit tree. Contract does not
        // verify the commitment's opening — the liquidator's later
        // withdraw is gated by the standard withdraw circuit, which
        // enforces amount == denomination(asset). If the liquidator
        // supplies a garbage commit, they simply can't spend it later;
        // no other user is harmed. Anonymity set stays intact because
        // the leaf is indistinguishable from any deposit commitment.
        let next_index = state::deposit_next_index(&env, &collateral_asset);
        let capacity = 1u64 << (merkle::DEPTH as u64);
        if next_index >= capacity {
            return Err(Error::TreeCapacityExceeded);
        }
        let mut frontier_arr =
            load_frontier(&env, state::deposit_frontier(&env, &collateral_asset));
        let bounty_fr = Fr::from_bytes(bounty_commit.clone());
        let new_root =
            merkle::append(&env, &bounty_fr, &mut frontier_arr, next_index);
        state::set_deposit_frontier(
            &env,
            &collateral_asset,
            &frontier_to_vec(&env, &frontier_arr),
        );
        state::set_deposit_root(&env, &collateral_asset, &new_root.to_bytes());
        state::set_deposit_next_index(&env, &collateral_asset, next_index + 1);
        state::set_total_deposit(
            &env,
            &collateral_asset,
            state::total_deposit(&env, &collateral_asset).saturating_add(1),
        );

        env.events().publish(
            (LIQUIDATE_EVENT, borrow_asset.clone()),
            (loan_commit_bytes, nullifier_bytes, liquidator.clone()),
        );
        // Also emit a DEPOSIT_EVENT so the scanner picks the bounty
        // leaf up on the next scan and materialises it as a
        // liquidator-owned deposit note.
        env.events().publish(
            (DEPOSIT_EVENT, collateral_asset.clone()),
            (next_index, new_root.to_bytes(), bounty_commit, bounty_memo),
        );
        Ok(())
    }

    /// Shielded liquidation v2 (Track A). Uses the pre-published loan
    /// nullifier from the LoanNullifier sidecar so a service worker
    /// holding only the memo openings — never the borrower's sk —
    /// can trigger. Requires a post-Track-A bond; pre-A loans stay on
    /// the v1 path via `liquidate_shielded`.
    ///
    /// Circuit public signals (5):
    ///   [0] borrow_amount_commit          from LiquidationBond
    ///   [1] collateral_value_commit       from LiquidationBond
    ///   [2] borrow_price_commit           from LiquidationBond
    ///   [3] current_price                 oracle-supplied
    ///   [4] threshold_bps                 matches risk_params.liquidation_threshold_bps
    ///
    /// `loan_commitment` + `loan_nullifier` come in as tx args; the
    /// contract validates them against `liquidation_bond` +
    /// `loan_nullifier` storage. Bounty payout is identical to v1.
    pub fn liquidate_shielded_v2(
        env: Env,
        liquidator: Address,
        borrow_asset: Symbol,
        collateral_asset: Symbol,
        loan_commitment: BytesN<32>,
        loan_nullifier: BytesN<32>,
        proof: BorrowProof,
        bounty_commit: BytesN<32>,
        bounty_memo: soroban_sdk::Bytes,
    ) -> Result<(), Error> {
        liquidator.require_auth();

        if proof.public_signals.len() != 5 {
            return Err(Error::InvalidProof);
        }
        let borrow_amount_commit_fr = proof.public_signals.get(0).unwrap();
        let collateral_value_commit_fr = proof.public_signals.get(1).unwrap();
        let borrow_price_commit_fr = proof.public_signals.get(2).unwrap();
        let threshold_fr = proof.public_signals.get(4).unwrap();

        let bond = state::liquidation_bond(&env, &loan_commitment)
            .ok_or(Error::InvalidProof)?;

        // Bond openings the circuit proved against must be the ones
        // the contract stored at borrow-time.
        if bond.borrow_amount_commit != borrow_amount_commit_fr.to_bytes()
            || bond.collateral_value_commit != collateral_value_commit_fr.to_bytes()
            || bond.borrow_price_commit != borrow_price_commit_fr.to_bytes()
        {
            return Err(Error::InvalidProof);
        }

        // Post-A bond gate: v2 requires the sidecar. Pre-A bonds
        // stay on the v1 fn where the circuit binds nullifier via sk.
        let expected_nullifier = state::loan_nullifier(&env, &loan_commitment)
            .ok_or(Error::InvalidProof)?;
        if expected_nullifier != loan_nullifier {
            return Err(Error::InvalidProof);
        }

        let expected_borrow_tag =
            notes::asset_tag(&env, &borrow_asset).ok_or(Error::AssetUnknown)?;
        if bond.borrow_asset_tag != expected_borrow_tag {
            return Err(Error::DenominationMismatch);
        }
        let expected_collateral_tag =
            notes::asset_tag(&env, &collateral_asset).ok_or(Error::AssetUnknown)?;
        if bond.collateral_asset_tag != expected_collateral_tag {
            return Err(Error::DenominationMismatch);
        }

        let risk = state::risk_params(&env).ok_or(Error::NotInitialized)?;
        if fr_to_u32(&threshold_fr) != risk.liquidation_threshold_bps {
            return Err(Error::InvalidProof);
        }

        let now = env.ledger().timestamp();
        if proof.oracle_epoch + MAX_ORACLE_AGE_SECS < now {
            return Err(Error::StaleOracle);
        }
        if proof.oracle_epoch > now + ORACLE_FUTURE_SKEW_SECS {
            return Err(Error::StaleOracle);
        }

        if state::nullifier_used(&env, &loan_nullifier) {
            return Err(Error::ProofReplayed);
        }

        if !liquidate_v2_verifier::verify_groth16(
            &env,
            proof.a.clone(),
            proof.b.clone(),
            proof.c.clone(),
            proof.public_signals.clone(),
        ) {
            return Err(Error::InvalidProof);
        }

        state::mark_nullifier_used(&env, &loan_nullifier);
        state::set_total_borrow(
            &env,
            &borrow_asset,
            state::total_borrow(&env, &borrow_asset).saturating_sub(1),
        );

        // Bounty payout — identical to v1 path.
        let next_index = state::deposit_next_index(&env, &collateral_asset);
        let capacity = 1u64 << (merkle::DEPTH as u64);
        if next_index >= capacity {
            return Err(Error::TreeCapacityExceeded);
        }
        let mut frontier_arr =
            load_frontier(&env, state::deposit_frontier(&env, &collateral_asset));
        let bounty_fr = Fr::from_bytes(bounty_commit.clone());
        let new_root =
            merkle::append(&env, &bounty_fr, &mut frontier_arr, next_index);
        state::set_deposit_frontier(
            &env,
            &collateral_asset,
            &frontier_to_vec(&env, &frontier_arr),
        );
        state::set_deposit_root(&env, &collateral_asset, &new_root.to_bytes());
        state::set_deposit_next_index(&env, &collateral_asset, next_index + 1);
        state::set_total_deposit(
            &env,
            &collateral_asset,
            state::total_deposit(&env, &collateral_asset).saturating_add(1),
        );

        env.events().publish(
            (LIQUIDATE_EVENT, borrow_asset.clone()),
            (loan_commitment, loan_nullifier, liquidator.clone()),
        );
        env.events().publish(
            (DEPOSIT_EVENT, collateral_asset.clone()),
            (next_index, new_root.to_bytes(), bounty_commit, bounty_memo),
        );
        Ok(())
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

fn fr_to_u128(value: &Fr) -> u128 {
    let bytes = value.to_bytes();
    let raw: [u8; 32] = bytes.into();
    let mut out: u128 = 0;
    for byte in raw.iter().skip(16) {
        out = (out << 8) | (*byte as u128);
    }
    out
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
