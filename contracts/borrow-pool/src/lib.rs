#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    symbol_short, Address, BytesN, Env, Symbol, Vec,
};

mod borrow_verifier;
mod deposit_verifier;
mod deposit_quad_verifier;
mod jubjub;
mod liquidate_v2_verifier;
mod liquidate_verifier;
mod merkle;
mod merkle_zeros;
mod notes;
mod poseidon;
mod poseidon_constants;
mod price_cap_client;
mod rate;
mod repay_verifier;
mod state;
mod tokens;
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

/// R20: max allowed drift between `borrow_shielded`'s public
/// `oracle_price` signal and a live Reflector read, in basis points of
/// the live price. Covers the realistic gap between client-side proof
/// generation and tx confirmation (Reflector updates on its own
/// interval, not synced to submission time) — without some tolerance,
/// legitimate proofs would fail whenever the feed ticks between prove
/// and submit. 200 bps is a deliberately tight band: this check is what
/// makes the circuit's in-circuit LTV band a real solvency guard
/// instead of decorative (see docs/REMEDIATION.md R20), so it should
/// stay close to actual market drift, not a wide margin.
pub const ORACLE_PRICE_TOLERANCE_BPS: u32 = 200;

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
    /// R17: a field element decoded to a fund-moving or cap-deciding
    /// amount had non-zero high bits (would have silently wrapped
    /// under the old low-16-bytes-only read) or exceeded
    /// `MAX_NOTE_AMOUNT`. See `fr_to_amount_checked`.
    AmountOutOfRange = 14,
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

    /// R17 (split): wire the `borrow-cap-helper` contract address so
    /// `borrow_shielded` can reach it. Unset -> `borrow_shielded` falls
    /// back to its flat per-asset cap, same fail-closed shape as an
    /// absent Reflector feed.
    pub fn set_borrow_helper(env: Env, helper: Address) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        state::set_borrow_helper(&env, &helper);
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

    /// Bulk nullifier-used check. Returns a boolean per input in the
    /// same order — `true` means the nullifier has already been marked
    /// spent by a prior withdraw / borrow / repay / liquidate. Kept as
    /// a batch view so a client scanning many notes at once pays one
    /// RPC round trip instead of N.
    pub fn nullifiers_used(
        env: Env,
        asset: Symbol,
        nullifiers: Vec<BytesN<32>>,
    ) -> Vec<bool> {
        let mut out: Vec<bool> = Vec::new(&env);
        for n in nullifiers.iter() {
            out.push_back(state::deposit_nullifier_used(&env, &asset, &n));
        }
        out
    }

    /// Loan-tree counterpart of `nullifiers_used` — reads the loan
    /// nullifier namespace (withdraw_loan / repay / liquidate marks)
    /// for `asset`'s loan tree.
    pub fn loan_nullifiers_used(
        env: Env,
        asset: Symbol,
        nullifiers: Vec<BytesN<32>>,
    ) -> Vec<bool> {
        let mut out: Vec<bool> = Vec::new(&env);
        for n in nullifiers.iter() {
            out.push_back(state::loan_nullifier_used(&env, &asset, &n));
        }
        out
    }

    pub fn total_borrow(env: Env, asset: Symbol) -> u128 {
        state::total_borrow(&env, &asset)
    }

    /// R17 value-sum counters (raw asset units) — distinct from
    /// `total_deposit`/`total_borrow`'s note counts. Exposed so the
    /// frontend can read real deposited/borrowed value now that notes
    /// are variable-amount.
    pub fn total_deposit_value(env: Env, asset: Symbol) -> u128 {
        state::total_deposit_value(&env, &asset)
    }

    pub fn total_borrow_value(env: Env, asset: Symbol) -> u128 {
        state::total_borrow_value(&env, &asset)
    }

    /// R20: running per-asset Jubjub Pedersen aggregate, folded via EC
    /// addition on every `borrow_shielded` call. Returns the curve
    /// identity `(0, 1)` before any R20-era borrow has occurred —
    /// callers can check that to tell "no borrows yet" from "some
    /// borrows happened" without decoding any individual amount.
    pub fn running_collateral_commit(env: Env, asset: Symbol) -> jubjub::JubjubPoint {
        state::running_collateral_commit(&env, &asset)
    }

    pub fn running_loan_commit(env: Env, asset: Symbol) -> jubjub::JubjubPoint {
        state::running_loan_commit(&env, &asset)
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
    // sk + salt for the declared commitment. R17: amount is real user
    // input (checked-conversion range-guarded), not a fixed
    // denomination — contract asserts the transferred amount matches
    // the DECLARED amount; a bug here lets an attacker mint a
    // commitment claiming more collateral than they parked in the pool.

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
        // R17: amount is real user input, not a fixed denomination —
        // checked-conversion rejects an out-of-range field element
        // (see fr_to_amount_checked), then just requires positive.
        let declared_amount = fr_to_amount_checked(&amount_fr)?;
        if declared_amount <= 0 {
            return Err(Error::AmountOutOfRange);
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

        // Pull collateral into the contract. R17: transfer the
        // DECLARED amount, not a looked-up denomination constant — the
        // two only had to match while the equality check above enforced
        // it; now that it doesn't, using the wrong one here would pull
        // the wrong quantity of real tokens against a note that commits
        // to a different value.
        tokens::transfer_in(&env, &asset, &from, declared_amount);

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
        state::set_total_deposit_value(
            &env,
            &asset,
            state::total_deposit_value(&env, &asset)
                .saturating_add(declared_amount as u128),
        );

        // Publish `(index, commitment, memo, amount)` so any client can
        // reconstruct the tree from events without contract storage
        // reads. Commitment is public (a Poseidon output that leaks
        // nothing about amount/sk/salt); memo remains encrypted for
        // the recipient only. R17: `amount` is appended so public
        // history replay (features/markets/market-history.ts) can
        // reflect real deposited value instead of a fixed unit — a new
        // on-chain leak of this deposit's amount at deposit time,
        // additional to (not the same as) the collateral-value leak at
        // borrow time. See docs/REMEDIATION.md R17.
        env.events().publish(
            (DEPOSIT_EVENT, asset.clone()),
            (
                next_index,
                new_root.to_bytes(),
                leaf.to_bytes(),
                memo,
                declared_amount,
            ),
        );
        Ok(next_index)
    }

    /// Quad-deposit variant that ships FOUR leaves under one Groth16
    // proof. Public signals order (snarkjs outputs first):
    //   [0..3] commitment[0..3]
    //   [4]    amount     (R17: real user input, shared across all 4 notes — RAW token units)
    //   [5]    asset_tag  (0 = XLM, 1 = USDC, 2 = EURC)
    // The circuit constrains each `commitment[i] == Poseidon(amount,
    // asset_tag, sk, salt_i)` for a shared `sk` AND a shared `amount`
    // (one amount signal for all 4 notes — a quad deposit always
    // produces 4 equally-sized notes; a user wanting 4 different sizes
    // needs 4 singleton `deposit_shielded` calls instead). One pairing
    // check on chain covers all four, so the per-tx CPU budget only
    // pays for verification once — an ordinary `deposit_shielded_batch`
    // at N=4 runs 4 verifies (~240M CPU) which trips the network's
    // 100M cap. Contract still transfers the declared amount four
    // times and appends four leaves, so the caller pushes `4 *
    // declared_amount` worth of the underlying token in one shot.
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

        let asset_tag_fr = proof.public_signals.get(5).unwrap();
        if fr_to_u32(&asset_tag_fr) != expected_tag {
            return Err(Error::DenominationMismatch);
        }
        // R17: one shared declared amount for all 4 notes.
        let amount_fr = proof.public_signals.get(4).unwrap();
        let declared_amount = fr_to_amount_checked(&amount_fr)?;
        if declared_amount <= 0 {
            return Err(Error::AmountOutOfRange);
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
        // 100M per-tx cap.
        tokens::transfer_in(&env, &asset, &from, declared_amount * 4);

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
        // R17: amount appended per-event (see deposit_shielded's note
        // on the new leak this represents).
        for i in 0u32..4 {
            let leaf_fr = proof.public_signals.get(i).unwrap();
            env.events().publish(
                (DEPOSIT_EVENT, asset.clone()),
                (
                    next_index + (i as u64),
                    new_root_bytes.clone(),
                    leaf_fr.to_bytes(),
                    memos.get(i).unwrap().clone(),
                    declared_amount,
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
        state::set_total_deposit_value(
            &env,
            &asset,
            state::total_deposit_value(&env, &asset)
                .saturating_add((declared_amount as u128).saturating_mul(4)),
        );

        Ok(indexes)
    }

    /// Batched `deposit_shielded`. `proofs[i]` mints the leaf described
    // by `memos[i]`; the pair length must match. Signed once at the
    // caller (single `from.require_auth()`), so the wallet UX only
    // prompts once for a full round of shielded collateral instead of
    // N separate deposits. Returns the assigned leaf indexes in the
    // same order the proofs came in.
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
        let capacity = 1u64 << (merkle::DEPTH as u64);

        // Load the frontier ONCE, mutate in place across every leaf so
        // storage-write cost stays proportional to N instead of N * DEPTH.
        let mut frontier_arr =
            load_frontier(&env, state::deposit_frontier(&env, &asset));
        let mut next_index = state::deposit_next_index(&env, &asset);
        let mut total = state::total_deposit(&env, &asset);
        let mut total_value = state::total_deposit_value(&env, &asset);
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
            // R17: each proof in the batch may declare its own amount.
            let declared_amount = fr_to_amount_checked(&amount_fr)?;
            if declared_amount <= 0 {
                return Err(Error::AmountOutOfRange);
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

            tokens::transfer_in(&env, &asset, &from, declared_amount);

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
                    declared_amount,
                ),
            );
            indexes.push_back(next_index);
            last_root_bytes = Some(new_root_bytes);
            next_index += 1;
            total = total.saturating_add(1);
            total_value = total_value.saturating_add(declared_amount as u128);
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
        state::set_total_deposit_value(&env, &asset, total_value);

        Ok(indexes)
    }

    /// Burn one deposit note via zk proof, release its real (R17:
    // variable) amount to `to`. Prover shows Merkle inclusion at the
    // current deposit_root plus a valid nullifier so the contract
    // can block reuse. Provably safe to trust the declared amount
    // without a separate equality check: `denomination` (really "the
    // note's amount") is fed directly into the circuit's Poseidon
    // commitment (`withdraw.circom:87`), and Merkle inclusion only
    // succeeds if that commitment matches a leaf that's actually in
    // the tree — a prover cannot declare an amount different from
    // what was really deposited without breaking the inclusion proof.
    ///
    // Public signals order: [asset_tag, denomination, deposit_root,
    // nullifier].
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
        // R17: declared amount, checked-conversion range-guarded (see
        // fr_to_amount_checked) instead of equality-checked against a
        // fixed denomination.
        let declared_amount = fr_to_amount_checked(&denomination_fr)?;
        if declared_amount <= 0 {
            return Err(Error::AmountOutOfRange);
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
        if state::deposit_nullifier_used(&env, &asset, &nullifier_bytes) {
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

        state::mark_deposit_nullifier_used(&env, &asset, &nullifier_bytes);

        // Release tokens back to the caller.
        tokens::transfer_out(&env, &asset, &to, declared_amount);

        // Aggregate accounting: one fewer active deposit note.
        state::set_total_deposit(
            &env,
            &asset,
            state::total_deposit(&env, &asset).saturating_sub(1),
        );
        state::set_total_deposit_value(
            &env,
            &asset,
            state::total_deposit_value(&env, &asset)
                .saturating_sub(declared_amount as u128),
        );

        env.events().publish(
            (WITHDRAW_EVENT, asset.clone()),
            (nullifier_bytes.clone(), to.clone(), declared_amount),
        );
        Ok(())
    }

    /// Shielded borrow. Consumes N=4 collateral notes via nullifiers,
    // appends a new loan-note commitment to the loan tree, emits an
    // encrypted memo attaching the note metadata for the borrower.
    ///
    // Public signals order (must match the borrow circuit). Circuit
    // OUTPUTS sort before {public [...]}-listed INPUTS in snarkjs's
    // ordering. R20: `total_collateral_amount`/`borrow_amount` are no
    // longer public at all (see borrow.circom's R20 header comment for
    // why); `oracle_price` moved from private witness to public input
    // instead, and two new Jubjub Pedersen commitment outputs replace
    // the old amount signals:
    //   [0]      collateral_pedersen_u (R20 OUTPUT — Pedersen commit to total_collateral_amount)
    //   [1]      collateral_pedersen_v
    //   [2]      loan_pedersen_u       (R20 OUTPUT — Pedersen commit to borrow_amount)
    //   [3]      loan_pedersen_v
    //   [4]      oracle_price          (R20: now public + contract-verified against live Reflector)
    //   [5]      borrow_asset_tag
    //   [6]      collateral_asset_tag
    //   [7]      hf_min_bps
    //   [8]      max_ltv_bps
    //   [9]      deposit_root
    //   [10]     borrow_commitment
    //   [11..15] nullifiers[0..4]
    pub fn borrow_shielded(
        env: Env,
        from: Address,
        collateral_asset: Symbol,
        borrow_asset: Symbol,
        proof: BorrowProof,
        memo: soroban_sdk::Bytes,
    ) -> Result<u64, Error> {
        from.require_auth();

        if proof.public_signals.len() != 19 {
            return Err(Error::InvalidProof);
        }
        let collateral_pedersen_u_fr = proof.public_signals.get(0).unwrap();
        let collateral_pedersen_v_fr = proof.public_signals.get(1).unwrap();
        let loan_pedersen_u_fr = proof.public_signals.get(2).unwrap();
        let loan_pedersen_v_fr = proof.public_signals.get(3).unwrap();
        let oracle_price_fr = proof.public_signals.get(4).unwrap();
        let borrow_tag_fr = proof.public_signals.get(5).unwrap();
        let collateral_tag_fr = proof.public_signals.get(6).unwrap();
        let hf_min_fr = proof.public_signals.get(7).unwrap();
        let max_ltv_fr = proof.public_signals.get(8).unwrap();
        let deposit_root_fr = proof.public_signals.get(9).unwrap();
        let borrow_commit_fr = proof.public_signals.get(10).unwrap();
        let borrow_amount_commit_fr = proof.public_signals.get(15).unwrap();
        let collateral_value_commit_fr = proof.public_signals.get(16).unwrap();
        let borrow_price_commit_fr = proof.public_signals.get(17).unwrap();
        let loan_nullifier_fr = proof.public_signals.get(18).unwrap();

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

        // R20: THE solvency guard now lives entirely inside the circuit
        // (borrow.circom's GreaterEqThan/LessEqThan LTV band), using
        // `oracle_price` as a real public input the circuit itself
        // constrains `total_collateral_value` against — not an
        // unconstrained private witness a prover could pick freely
        // (the pre-R20 gap: total_collateral_amount was honest but
        // decorative once multiplied by an unchecked price). The
        // contract's only remaining job on the price side is verifying
        // that public `oracle_price` matches a live Reflector read, so
        // the circuit's own band means what it claims to mean. Fails
        // closed (Error::StaleOracle) if Reflector has no live feed for
        // either leg, or the proof's price falls outside
        // ORACLE_PRICE_TOLERANCE_BPS of a live read. There's no flat-
        // denomination fallback left (unlike pre-R20's `dynamic_borrow_
        // cap`) — `borrow_amount` is a private witness only the circuit
        // checks against a price now, so there's nothing left for the
        // contract to bound a fallback cap against.
        let oracle_price = fr_to_amount_checked(&oracle_price_fr)?;
        if oracle_price <= 0 {
            return Err(Error::AmountOutOfRange);
        }
        verify_live_price(&env, &collateral_asset, &borrow_asset, oracle_price)?;

        // Deposit root sanity: must match the current on-chain state.
        let stored_root = state::deposit_root(&env, &collateral_asset)
            .ok_or(Error::InvalidProof)?;
        if stored_root != deposit_root_fr.to_bytes() {
            return Err(Error::InvalidProof);
        }

        // Nullifier freshness: all four must be unused. R20: indices
        // shifted to 11..15 — see the signal-order table in this
        // function's doc comment.
        let mut nullifier_bytes: [soroban_sdk::BytesN<32>; 4] = [
            proof.public_signals.get(11).unwrap().to_bytes(),
            proof.public_signals.get(12).unwrap().to_bytes(),
            proof.public_signals.get(13).unwrap().to_bytes(),
            proof.public_signals.get(14).unwrap().to_bytes(),
        ];
        for null in nullifier_bytes.iter() {
            if state::deposit_nullifier_used(&env, &collateral_asset, null) {
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
            state::mark_deposit_nullifier_used(&env, &collateral_asset, null);
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

        // Note-count counters: unaffected by R20, one fewer/one more
        // note either way regardless of amount (mirrors repay_shielded's
        // identical reasoning for its own note-count updates).
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
        // R20 value counters (total_deposit_value/total_borrow_value)
        // are DELIBERATELY NOT adjusted here anymore: total_collateral_
        // amount and borrow_amount are now pure private witnesses (see
        // borrow.circom's R20 header comment) — the contract has no
        // honest clear-text amount left to decrement/increment by.
        // Same accepted-limitation category repay_shielded already
        // disclosed for its own value-counter gap: these counters drift
        // stale relative to real backing as R20 borrows accumulate.
        // Logged, not silently ignored — see docs/REMEDIATION.md R20.
        rate::accrue_borrow_index(&env, &borrow_asset);

        // R20: fold this borrow's Pedersen commitments into the running
        // per-asset homomorphic aggregate via Jubjub EC addition. The
        // contract never decodes an individual amount from these points
        // — only ever adds them (see jubjub.rs's header comment).
        let collateral_point = jubjub::JubjubPoint {
            u: collateral_pedersen_u_fr.clone(),
            v: collateral_pedersen_v_fr.clone(),
        };
        let running_collateral = jubjub::jubjub_add(
            &env,
            &state::running_collateral_commit(&env, &collateral_asset),
            &collateral_point,
        );
        state::set_running_collateral_commit(&env, &collateral_asset, &running_collateral);

        let loan_point = jubjub::JubjubPoint {
            u: loan_pedersen_u_fr.clone(),
            v: loan_pedersen_v_fr.clone(),
        };
        let running_loan = jubjub::jubjub_add(
            &env,
            &state::running_loan_commit(&env, &borrow_asset),
            &loan_point,
        );
        state::set_running_loan_commit(&env, &borrow_asset, &running_loan);

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
            (
                next_index,
                new_root.to_bytes(),
                leaf.to_bytes(),
                memo,
                // Publish the four spent collateral nullifiers so the
                // client-side scanner can drop the deposit tombstones
                // without holding on to per-session in-memory state
                // (survives page reload / cross-device).
                nullifier_bytes[0].clone(),
                nullifier_bytes[1].clone(),
                nullifier_bytes[2].clone(),
                nullifier_bytes[3].clone(),
                // R20: total_collateral_amount/declared_borrow_amount no
                // longer exist as clear-text signals — that was the
                // whole point of this change. Publish the Pedersen
                // commitment points instead: costs little, and keeps
                // the door open for a future off-chain tool to verify
                // the running aggregate without ever learning any
                // individual amount. market-history.ts's amount/
                // collateralAmount decode falls back to its existing
                // DENOMINATION approximation for this event shape (same
                // path already wired for pre-R17/repay events).
                collateral_pedersen_u_fr.to_bytes(),
                collateral_pedersen_v_fr.to_bytes(),
                loan_pedersen_u_fr.to_bytes(),
                loan_pedersen_v_fr.to_bytes(),
            ),
        );
        Ok(next_index)
    }

    /// Loan-tree variant of withdraw. Same Groth16 circuit as the
    // deposit-side withdraw, but the contract checks the caller's
    // declared `amount` against the loan tree's root instead of the
    // fixed deposit denomination. Payout size is variable (whatever
    // the borrow proof committed to), so this DOES leak the loan
    // amount publicly on Horizon — accepted trade-off for MVP: chain
    // observer sees an unlinkable withdrawal of amount X, no wallet
    // linkage to any specific borrow tx.
    ///
    // R17: no separate ceiling check against the old flat denomination
    // here — `borrow_shielded` can now legitimately mint above it (see
    // its dynamic-cap comment), so that number is no longer a valid
    // upper bound on a real claim. The amount doesn't need a second
    // ceiling anyway: it's bound into the Poseidon commitment
    // (`withdraw.circom:87`), so Merkle inclusion against the loan
    // root only succeeds if it matches a leaf `borrow_shielded` really
    // appended — meaning it was already checked against the cap that
    // applied AT MINT TIME. `fr_to_amount_checked` still bounds the
    // value to a sane overall ceiling regardless (protects against the
    // field-wraparound class of attack, not a business-logic cap).
    ///
    // Public signals order (same as withdraw_shielded):
    //   [0] asset_tag
    //   [1] amount           (borrow amount minted by borrow_shielded)
    //   [2] loan_root
    //   [3] nullifier
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

        // R17: checked-conversion (was fr_to_i128 — the same
        // truncation gap fr_to_amount_checked closes elsewhere) plus a
        // positivity check; no separate flat-denomination ceiling (see
        // doc comment above).
        let amount = fr_to_amount_checked(&amount_fr)?;
        if amount <= 0 {
            return Err(Error::AmountOutOfRange);
        }

        let stored_root =
            state::loan_root(&env, &asset).ok_or(Error::InvalidProof)?;
        if stored_root != loan_root_fr.to_bytes() {
            return Err(Error::InvalidProof);
        }

        let nullifier_bytes = nullifier_fr.to_bytes();
        if state::loan_nullifier_used(&env, &asset, &nullifier_bytes) {
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

        state::mark_loan_nullifier_used(&env, &asset, &nullifier_bytes);

        tokens::transfer_out(&env, &asset, &to, amount);

        state::set_total_borrow(
            &env,
            &asset,
            state::total_borrow(&env, &asset).saturating_sub(1),
        );
        state::set_total_borrow_value(
            &env,
            &asset,
            state::total_borrow_value(&env, &asset).saturating_sub(amount as u128),
        );

        env.events().publish(
            (WITHDRAW_EVENT, asset.clone(), Symbol::new(&env, "loan")),
            (nullifier_bytes.clone(), to.clone(), amount),
        );
        Ok(amount)
    }

    /// Shielded repay. Burns one loan note + one same-asset deposit
    // note. Circuit enforces
    //   `deposit_amount * borrow_index_snapshot >=
    //    loan_amount    * borrow_index_now`
    // so the pool is made whole for the accrued debt. Both
    // nullifiers marked used, aggregate borrow + deposit counters
    // decremented. No public transfer.
    ///
    // Public signals:
    //   [0] asset_tag
    //   [1] loan_root
    //   [2] deposit_root
    //   [3] loan_nullifier
    //   [4] deposit_nullifier
    //   [5] borrow_index_snapshot    (Track D)
    //   [6] borrow_index_now         (Track D)
    ///
    // `loan_commitment` comes in as a tx arg so the contract can
    // look up the BorrowIndexAtOpen sidecar; pre-D loans without
    // the sidecar are grandfathered as zero-interest by treating
    // `snapshot = index_now` (the ratio collapses to 1.0).
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
        if state::loan_nullifier_used(&env, &asset, &loan_nul_bytes)
            || state::deposit_nullifier_used(&env, &asset, &dep_nul_bytes)
        {
            return Err(Error::ProofReplayed);
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
        // `index_now` accrues with ledger time, so it is strictly larger
        // by the time this executes than when the client read it and
        // started proving (~1 min). Demanding equality made repay
        // unwinnable — the client cannot predict the execution
        // timestamp. Accept any index at least as accrued as ours: the
        // circuit checks `deposit * snapshot >= loan * now`, so a larger
        // `index_now` only makes the borrower prove MORE debt coverage.
        // Stale (smaller) values stay rejected — those would understate
        // accrued interest.
        if fr_to_u128(&index_now_fr) < index_now {
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

        state::mark_loan_nullifier_used(&env, &asset, &loan_nul_bytes);
        state::mark_deposit_nullifier_used(&env, &asset, &dep_nul_bytes);

        // Note-count counters: unaffected by R17, one fewer note either
        // way regardless of amount.
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
        // R17 value counters (total_borrow_value/total_deposit_value)
        // are DELIBERATELY NOT adjusted here: repay_shielded's public
        // signals carry no amount at all (loan_amount/deposit_amount
        // are private witnesses, only proven via the Track D
        // inequality — "No public transfer" per this function's own
        // header comment), so the contract has no honest amount to
        // decrement by without a repay.circom change, which is out of
        // R17's approved scope (repay needs no circuit change). Known
        // limitation: the value counters drift (over-count) relative to
        // real backing as repays accumulate — logged as a follow-up,
        // not silently ignored. See docs/REMEDIATION.md R17.

        env.events().publish(
            (REPAY_EVENT, asset.clone()),
            (loan_nul_bytes, dep_nul_bytes, from.clone()),
        );
        Ok(())
    }

    /// Shielded liquidation (v1). Permissionless — any caller who
    // holds the memo openings for an underwater loan can burn its
    // nullifier via the sk-binding liquidate circuit. Contract
    // cross-checks the 3 bond commitments in the proof match the
    // stored `LiquidationBond` and enforces the risk-params
    // threshold. Bounty payout (Track C-simple) mints a fresh
    // denomination note to the liquidator via the caller-supplied
    // commitment; see the append + DEPOSIT_EVENT below.
    // Post-Track-A bonds route through `liquidate_shielded_v2`
    // (no sk in the circuit); this fn stays as the grandfathered
    // path for pre-A loans. See docs/liquidation-design.md.
    ///
    // Public signals:
    //   [0] loan_commitment
    //   [1] borrow_amount_commit
    //   [2] collateral_value_commit
    //   [3] borrow_price_commit
    //   [4] current_price
    //   [5] threshold_bps
    //   [6] loan_nullifier
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

        // R22: current_price is now cross-checked against a live
        // Reflector read (same shape as borrow_shielded's oracle_price,
        // R20) instead of only a non-zero guard — a prover could
        // otherwise supply any non-zero price and the circuit's
        // underwater check would evaluate against a fabricated number.
        let current_price = fr_to_amount_checked(&proof.public_signals.get(4).unwrap())?;
        if current_price <= 0 {
            return Err(Error::AmountOutOfRange);
        }
        verify_live_price(&env, &collateral_asset, &borrow_asset, current_price)?;

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
        if state::loan_nullifier_used(&env, &borrow_asset, &nullifier_bytes) {
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

        state::mark_loan_nullifier_used(&env, &borrow_asset, &nullifier_bytes);
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
    // nullifier from the LoanNullifier sidecar so a service worker
    // holding only the memo openings — never the borrower's sk —
    // can trigger. Requires a post-Track-A bond; pre-A loans stay on
    // the v1 path via `liquidate_shielded`.
    ///
    // Circuit public signals (5):
    //   [0] borrow_amount_commit          from LiquidationBond
    //   [1] collateral_value_commit       from LiquidationBond
    //   [2] borrow_price_commit           from LiquidationBond
    //   [3] current_price                 oracle-supplied
    //   [4] threshold_bps                 matches risk_params.liquidation_threshold_bps
    ///
    // `loan_commitment` + `loan_nullifier` come in as tx args; the
    // contract validates them against `liquidation_bond` +
    // `loan_nullifier` storage. Bounty payout is identical to v1.
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

        // R22: current_price is now cross-checked against a live
        // Reflector read instead of only a non-zero guard — see the
        // matching comment in liquidate_shielded (v1).
        let current_price = fr_to_amount_checked(&proof.public_signals.get(3).unwrap())?;
        if current_price <= 0 {
            return Err(Error::AmountOutOfRange);
        }
        verify_live_price(&env, &collateral_asset, &borrow_asset, current_price)?;

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

        if state::loan_nullifier_used(&env, &borrow_asset, &loan_nullifier) {
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

        state::mark_loan_nullifier_used(&env, &borrow_asset, &loan_nullifier);
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

fn fr_to_u128(value: &Fr) -> u128 {
    let bytes = value.to_bytes();
    let raw: [u8; 32] = bytes.into();
    let mut out: u128 = 0;
    for byte in raw.iter().skip(16) {
        out = (out << 8) | (*byte as u128);
    }
    out
}

/// Generous ceiling for any single note/loan amount, RAW asset units —
/// ~1e11x the largest current denomination (10_000_000 XLM stroops),
/// while staying far under BLS12-381's field modulus (~2^255) and
/// under 2^128 with headroom for `amount * oracle_price` (1e14-scaled)
/// inside the borrow circuit's own 128-bit comparators.
const MAX_NOTE_AMOUNT: i128 = 1_000_000_000_000_000_000;

/// Checked Fr -> i128 for any field element that becomes a fund-moving
/// or cap-deciding amount. Rejects a field element whose high 16 bytes
/// are non-zero, instead of the naive approach of silently discarding
/// them (which `fr_to_u32`/`fr_to_u128` above still do — safe for their
/// actual callers: `fr_to_u32` reads tags/bps values that are always
/// small, `fr_to_u128` reads the Track D index ratio, a separate,
/// already-documented gap outside R17's approved scope — see this
/// function's own note in docs/REMEDIATION.md).
///
/// R17: a prover controls the full ~255-bit field element for values
/// like `oracle_price` (R20: now public, but still prover-supplied
/// before the live-Reflector cross-check runs). Without this
/// check, a chosen field element that wraps past 2^128 lets its
/// truncated low-128-bit projection read as any attacker-picked
/// cap-passing amount while the real proven collateral is far
/// smaller — this closes that gap. It also gates every relaxed
/// deposit/withdraw equality check below, and `withdraw_loan_shielded`'s
/// pre-existing payout read (same-class gap, unrelated to R17's new
/// signal, bundled here since the file's already being touched for
/// this redeploy). See docs/REMEDIATION.md R17/R17a.
fn fr_to_amount_checked(value: &Fr) -> Result<i128, Error> {
    let bytes = value.to_bytes();
    let raw: [u8; 32] = bytes.into();
    if raw[..16].iter().any(|b| *b != 0) {
        return Err(Error::AmountOutOfRange);
    }
    let mut low: u128 = 0;
    for byte in raw.iter().skip(16) {
        low = (low << 8) | (*byte as u128);
    }
    if low > MAX_NOTE_AMOUNT as u128 {
        return Err(Error::AmountOutOfRange);
    }
    Ok(low as i128)
}

fn fr_to_u32(value: &Fr) -> u32 {
    let bytes = value.to_bytes();
    let raw: [u8; 32] = bytes.into();
    ((raw[28] as u32) << 24)
        | ((raw[29] as u32) << 16)
        | ((raw[30] as u32) << 8)
        | (raw[31] as u32)
}

/// R17 (split): price-aware borrow cap from REAL, honest collateral
/// (the circuit-proven `total_collateral_amount`, no price factor
/// baked in by the prover). The actual Reflector read + LTV math now
/// live in the separate `borrow-cap-helper` contract (kept out of this
/// contract's own WASM so calls that never need it — deposit/withdraw/
/// repay/liquidate — don't pay to parse that code; see
/// docs/REMEDIATION.md R17). Returns `None` (caller falls back to the
/// flat denomination cap) if no helper is wired, or the helper reports
/// no live Reflector feed for either leg — same fail-closed posture as
/// before the split, not a behavior change.
/// R20: the cap check this fed moved entirely into the circuit (see
/// borrow_shielded's R20 comment) — `live_oracle_price` below is what
/// borrow_shielded actually calls now. Left in place rather than
/// deleted, along with `borrow-cap-helper`'s own now-unused-by-this-path
/// `dynamic_borrow_cap` entrypoint: removing a whole contract is a
/// separate, lower-priority cleanup, not core to R20.
#[allow(dead_code)]
fn dynamic_borrow_cap(
    env: &Env,
    collateral_asset: &Symbol,
    borrow_asset: &Symbol,
    total_collateral_amount: i128,
    max_ltv_bps: u32,
) -> Option<i128> {
    let helper = state::borrow_helper(env)?;
    let reflector_contract = state::reflector(env)?;
    let collateral_decimals = notes::decimals(env, collateral_asset)?;
    let borrow_decimals = notes::decimals(env, borrow_asset)?;

    price_cap_client::BorrowCapHelperClient::new(env, &helper)
        .try_dynamic_borrow_cap(
            &reflector_contract,
            collateral_asset,
            borrow_asset,
            &collateral_decimals,
            &borrow_decimals,
            &total_collateral_amount,
            &max_ltv_bps,
        )
        .ok()?
        .ok()?
}

/// R20: live 1e14-scaled price ratio, used to cross-check
/// `borrow_shielded`'s now-public `oracle_price` signal against a real
/// Reflector read. `None` if no helper is wired or Reflector has no
/// live feed for either leg — `borrow_shielded` fails closed on `None`
/// (`Error::StaleOracle`) since there is no fallback cap left once
/// `borrow_amount` is a private witness the circuit alone checks
/// against a price.
fn live_oracle_price(env: &Env, collateral_asset: &Symbol, borrow_asset: &Symbol) -> Option<i128> {
    let helper = state::borrow_helper(env)?;
    let reflector_contract = state::reflector(env)?;
    let collateral_decimals = notes::decimals(env, collateral_asset)?;
    let borrow_decimals = notes::decimals(env, borrow_asset)?;

    price_cap_client::BorrowCapHelperClient::new(env, &helper)
        .try_price_ratio(
            &reflector_contract,
            collateral_asset,
            borrow_asset,
            &collateral_decimals,
            &borrow_decimals,
        )
        .ok()?
        .ok()?
}

/// R22: shared oracle-price cross-check, extracted from R20's inline
/// `borrow_shielded` block so `liquidate_shielded`/`liquidate_shielded_v2`
/// can reuse the exact same fail-closed logic for `current_price`
/// instead of a third copy — verifies `claimed_price` (already
/// range-checked via `fr_to_amount_checked` by the caller) matches a
/// live Reflector read within `ORACLE_PRICE_TOLERANCE_BPS`.
fn verify_live_price(
    env: &Env,
    collateral_asset: &Symbol,
    borrow_asset: &Symbol,
    claimed_price: i128,
) -> Result<(), Error> {
    let live_price =
        live_oracle_price(env, collateral_asset, borrow_asset).ok_or(Error::StaleOracle)?;
    let price_diff = (claimed_price - live_price).abs();
    if price_diff.saturating_mul(10_000) > live_price.saturating_mul(ORACLE_PRICE_TOLERANCE_BPS as i128)
    {
        return Err(Error::StaleOracle);
    }
    Ok(())
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

impl BorrowPool {
    fn require_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }
}
