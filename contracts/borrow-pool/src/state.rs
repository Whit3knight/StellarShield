//! Typed storage layout for the shielded lending pool.
//!
//! All persistent state lives here. Every read + write goes through
//! typed getters/setters so the storage keys never leak into business
//! logic. Instance storage for tiny admin data (Admin address, params,
//! Reflector contract); persistent storage for anything that grows
//! (markets, per-asset tree state, nullifier set, indices).

#![allow(dead_code)]

use soroban_sdk::{contracttype, Address, BytesN, Env, Symbol, Vec};

use crate::jubjub::JubjubPoint;
use crate::MarketMeta;

// Instance storage keys (all small, single-slot).
#[contracttype]
pub enum InstanceKey {
    Admin,
    Markets,
    RateParams,
    RiskParams,
    ReflectorContract,
    LiquidationServicePk,
    // R17: address of the `borrow-cap-helper` contract, the only
    // reader of `ReflectorContract` now (split out to keep this
    // contract's own WASM small — see reflector.rs's former header
    // comment / docs/REMEDIATION.md R17). `None` until wired via
    // `set_borrow_helper`; `borrow_shielded` falls back to its flat
    // cap when unset, same fail-closed shape as an absent price feed.
    BorrowHelperContract,
    // R23: address of the `repay-v2-verifier-helper` contract — split
    // out for the same WASM-parse-cost reason as `BorrowHelperContract`
    // (R17). `None` until wired via `set_repay_v2_verifier`;
    // `repay_shielded_v2` fails closed (`Error::NotInitialized`) when
    // unset, since there's no verification fallback.
    RepayV2VerifierContract,
}

// Persistent storage keys. Compound keys embed the discriminant so
// per-asset (or per-nullifier) values don't collide.
#[contracttype]
pub enum PersistentKey {
    DepositRoot(Symbol),
    DepositFrontier(Symbol),
    DepositNextIndex(Symbol),
    LoanRoot(Symbol),
    LoanFrontier(Symbol),
    LoanNextIndex(Symbol),
    DepositNullifier(Symbol, BytesN<32>),
    BorrowIndex(Symbol),
    LiquidityIndex(Symbol),
    TotalDeposit(Symbol),
    TotalBorrow(Symbol),
    // R17: value-sum counters (raw asset units), separate from the
    // note-count counters above. Note counts still drive Merkle
    // tree-indexing/capacity; these track how much VALUE is actually
    // deposited/borrowed now that notes are variable-amount. Missing
    // keys default to 0 (see total_deposit_value/total_borrow_value
    // below), so no migration step is needed — accrual just starts
    // from zero whenever this first gets written.
    TotalDepositValue(Symbol),
    TotalBorrowValue(Symbol),
    LiquidationBond(BytesN<32>),
    // Track A sidecar: pre-published loan nullifier keyed by
    // loan_commitment. Absent for pre-A bonds → liquidate falls back
    // to the sk-binding circuit. Present → service-triggerable.
    LoanNullifier(BytesN<32>),
    // Track D sidecar: borrow_index value at open, keyed by
    // loan_commitment. Repay uses the ratio (index_now / index_open)
    // to compute the accrued debt the repayer must cover. Absent for
    // pre-D loans → repay treats them as zero-interest.
    BorrowIndexAtOpen(BytesN<32>),
    // Loan-tree spent-nullifier namespace. `DepositNullifier` above is
    // the deposit-tree namespace. Both are keyed by (tree, asset):
    // nullifier = Poseidon(sk, leaf_index) carries no tree or asset
    // domain separation, so the same bytes recur at the same leaf index
    // in every one of the 6 trees. Only the storage key keeps them
    // apart. (Distinct from `LoanNullifier`, the Track A sidecar.)
    LoanNullifierUsed(Symbol, BytesN<32>),
    // R20: running per-asset Jubjub Pedersen aggregate, folded via EC
    // addition on every `borrow_shielded` call. Default = curve
    // identity (0, 1) — see `jubjub::JubjubPoint::identity`. No
    // consumer reads these today; they exist so a future audit/health
    // tool can verify aggregate solvency without any individual borrow
    // amount ever having been public. See docs/REMEDIATION.md R20.
    RunningCollateralCommit(Symbol),
    RunningLoanCommit(Symbol),
}

/// Public commitment tuple pinned at borrow-time so a liquidator can
/// later prove `debt × threshold > collateral × current_price` without
/// knowing the borrower's identity. See docs/liquidation-design.md.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidationBond {
    pub borrow_amount_commit: BytesN<32>,
    pub collateral_value_commit: BytesN<32>,
    pub borrow_price_commit: BytesN<32>,
    pub borrow_asset_tag: u32,
    pub collateral_asset_tag: u32,
    pub oracle_epoch: u64,
    pub opened_at: u64,
}

/// Rate curve parameters — read/written by the contract, exposed as a
/// public view for the frontend so client-side `deriveMarketMetrics`
/// stops using hardcoded curve constants.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateParams {
    pub base_apr_bps: u32,
    pub slope_apr_bps: u32,
    pub reserve_factor_bps: u32,
    pub seconds_per_year: u32,
}

/// Risk parameters. Values are basis points where sensible;
/// `hf_min_bps=12500` reads as 1.25×.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RiskParams {
    pub hf_min_bps: u32,
    pub max_ltv_bps: u32,
    pub liquidation_threshold_bps: u32,
    pub liquidation_bonus_bps: u32,
}

/// Pair of running index + the ledger timestamp of its last accrual.
/// `linear_accrue()` in `rate.rs` walks it forward.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexSnapshot {
    pub last_updated: u64,
    pub value: u128,
}

// --- Admin / initialisation ---------------------------------------------

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&InstanceKey::Admin)
}

// --- Reflector oracle contract -----------------------------------------

pub fn set_reflector(env: &Env, reflector: &Address) {
    env.storage()
        .instance()
        .set(&InstanceKey::ReflectorContract, reflector);
}

pub fn reflector(env: &Env) -> Option<Address> {
    env.storage().instance().get(&InstanceKey::ReflectorContract)
}

// --- Borrow-cap helper contract (R17 split) -----------------------------

pub fn set_borrow_helper(env: &Env, helper: &Address) {
    env.storage()
        .instance()
        .set(&InstanceKey::BorrowHelperContract, helper);
}

pub fn borrow_helper(env: &Env) -> Option<Address> {
    env.storage().instance().get(&InstanceKey::BorrowHelperContract)
}

// --- Repay-v2 verifier helper contract (R23 split) ----------------------

pub fn set_repay_v2_verifier(env: &Env, helper: &Address) {
    env.storage()
        .instance()
        .set(&InstanceKey::RepayV2VerifierContract, helper);
}

pub fn repay_v2_verifier(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get(&InstanceKey::RepayV2VerifierContract)
}

// --- Liquidation service pubkey (Track L) ------------------------------
//
// X25519 pubkey the borrower dual-encrypts memos to at borrow-time so a
// designated liquidation service can decrypt the openings needed to
// trigger `liquidate_shielded` on underwater positions. Empty = no
// service configured; new borrows encrypt to borrower only and stay
// non-liquidatable until the admin sets a key.

pub fn set_liquidation_service_pk(env: &Env, pk: &BytesN<32>) {
    env.storage()
        .instance()
        .set(&InstanceKey::LiquidationServicePk, pk);
}

pub fn liquidation_service_pk(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&InstanceKey::LiquidationServicePk)
}

// --- Rate / risk params -------------------------------------------------

pub fn set_rate_params(env: &Env, params: &RateParams) {
    env.storage().instance().set(&InstanceKey::RateParams, params);
}

pub fn rate_params(env: &Env) -> Option<RateParams> {
    env.storage().instance().get(&InstanceKey::RateParams)
}

pub fn set_risk_params(env: &Env, params: &RiskParams) {
    env.storage().instance().set(&InstanceKey::RiskParams, params);
}

pub fn risk_params(env: &Env) -> Option<RiskParams> {
    env.storage().instance().get(&InstanceKey::RiskParams)
}

// --- Markets registry --------------------------------------------------

pub fn markets(env: &Env) -> Vec<MarketMeta> {
    env.storage()
        .instance()
        .get(&InstanceKey::Markets)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_markets(env: &Env, markets: &Vec<MarketMeta>) {
    env.storage().instance().set(&InstanceKey::Markets, markets);
}

// --- Nullifier set ------------------------------------------------------

pub fn deposit_nullifier_used(env: &Env, asset: &Symbol, nullifier: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&PersistentKey::DepositNullifier(
            asset.clone(),
            nullifier.clone(),
        ))
}

pub fn mark_deposit_nullifier_used(env: &Env, asset: &Symbol, nullifier: &BytesN<32>) {
    env.storage().persistent().set(
        &PersistentKey::DepositNullifier(asset.clone(), nullifier.clone()),
        &true,
    );
}

pub fn loan_nullifier_used(env: &Env, asset: &Symbol, nullifier: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&PersistentKey::LoanNullifierUsed(
            asset.clone(),
            nullifier.clone(),
        ))
}

pub fn mark_loan_nullifier_used(env: &Env, asset: &Symbol, nullifier: &BytesN<32>) {
    env.storage().persistent().set(
        &PersistentKey::LoanNullifierUsed(asset.clone(), nullifier.clone()),
        &true,
    );
}

// --- Liquidation bond registry (Track L) -------------------------------

pub fn liquidation_bond(env: &Env, loan_commitment: &BytesN<32>) -> Option<LiquidationBond> {
    env.storage()
        .persistent()
        .get(&PersistentKey::LiquidationBond(loan_commitment.clone()))
}

pub fn set_liquidation_bond(
    env: &Env,
    loan_commitment: &BytesN<32>,
    bond: &LiquidationBond,
) {
    env.storage().persistent().set(
        &PersistentKey::LiquidationBond(loan_commitment.clone()),
        bond,
    );
}

pub fn loan_nullifier(env: &Env, loan_commitment: &BytesN<32>) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&PersistentKey::LoanNullifier(loan_commitment.clone()))
}

pub fn set_loan_nullifier(
    env: &Env,
    loan_commitment: &BytesN<32>,
    nullifier: &BytesN<32>,
) {
    env.storage().persistent().set(
        &PersistentKey::LoanNullifier(loan_commitment.clone()),
        nullifier,
    );
}

pub fn borrow_index_at_open(env: &Env, loan_commitment: &BytesN<32>) -> Option<u128> {
    env.storage()
        .persistent()
        .get(&PersistentKey::BorrowIndexAtOpen(loan_commitment.clone()))
}

pub fn set_borrow_index_at_open(
    env: &Env,
    loan_commitment: &BytesN<32>,
    value: u128,
) {
    env.storage().persistent().set(
        &PersistentKey::BorrowIndexAtOpen(loan_commitment.clone()),
        &value,
    );
}

// --- Per-asset tree state ----------------------------------------------

pub fn deposit_root(env: &Env, asset: &Symbol) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&PersistentKey::DepositRoot(asset.clone()))
}

pub fn set_deposit_root(env: &Env, asset: &Symbol, root: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&PersistentKey::DepositRoot(asset.clone()), root);
}

pub fn loan_root(env: &Env, asset: &Symbol) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&PersistentKey::LoanRoot(asset.clone()))
}

pub fn set_loan_root(env: &Env, asset: &Symbol, root: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&PersistentKey::LoanRoot(asset.clone()), root);
}

pub fn deposit_next_index(env: &Env, asset: &Symbol) -> u64 {
    env.storage()
        .persistent()
        .get(&PersistentKey::DepositNextIndex(asset.clone()))
        .unwrap_or(0u64)
}

pub fn set_deposit_next_index(env: &Env, asset: &Symbol, index: u64) {
    env.storage()
        .persistent()
        .set(&PersistentKey::DepositNextIndex(asset.clone()), &index);
}

pub fn loan_next_index(env: &Env, asset: &Symbol) -> u64 {
    env.storage()
        .persistent()
        .get(&PersistentKey::LoanNextIndex(asset.clone()))
        .unwrap_or(0u64)
}

pub fn set_loan_next_index(env: &Env, asset: &Symbol, index: u64) {
    env.storage()
        .persistent()
        .set(&PersistentKey::LoanNextIndex(asset.clone()), &index);
}

// Frontier is a Vec<BytesN<32>> of length merkle::DEPTH. Stored as a
// Soroban Vec so cost scales with actual length (well under the
// per-slot XDR limit at depth 20).
pub fn deposit_frontier(env: &Env, asset: &Symbol) -> Vec<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&PersistentKey::DepositFrontier(asset.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_deposit_frontier(env: &Env, asset: &Symbol, frontier: &Vec<BytesN<32>>) {
    env.storage()
        .persistent()
        .set(&PersistentKey::DepositFrontier(asset.clone()), frontier);
}

pub fn loan_frontier(env: &Env, asset: &Symbol) -> Vec<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&PersistentKey::LoanFrontier(asset.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_loan_frontier(env: &Env, asset: &Symbol, frontier: &Vec<BytesN<32>>) {
    env.storage()
        .persistent()
        .set(&PersistentKey::LoanFrontier(asset.clone()), frontier);
}

// --- Aggregate counters ------------------------------------------------

pub fn total_deposit(env: &Env, asset: &Symbol) -> u128 {
    env.storage()
        .persistent()
        .get(&PersistentKey::TotalDeposit(asset.clone()))
        .unwrap_or(0u128)
}

pub fn set_total_deposit(env: &Env, asset: &Symbol, value: u128) {
    env.storage()
        .persistent()
        .set(&PersistentKey::TotalDeposit(asset.clone()), &value);
}

pub fn total_borrow(env: &Env, asset: &Symbol) -> u128 {
    env.storage()
        .persistent()
        .get(&PersistentKey::TotalBorrow(asset.clone()))
        .unwrap_or(0u128)
}

pub fn set_total_borrow(env: &Env, asset: &Symbol, value: u128) {
    env.storage()
        .persistent()
        .set(&PersistentKey::TotalBorrow(asset.clone()), &value);
}

pub fn total_deposit_value(env: &Env, asset: &Symbol) -> u128 {
    env.storage()
        .persistent()
        .get(&PersistentKey::TotalDepositValue(asset.clone()))
        .unwrap_or(0u128)
}

pub fn set_total_deposit_value(env: &Env, asset: &Symbol, value: u128) {
    env.storage()
        .persistent()
        .set(&PersistentKey::TotalDepositValue(asset.clone()), &value);
}

pub fn total_borrow_value(env: &Env, asset: &Symbol) -> u128 {
    env.storage()
        .persistent()
        .get(&PersistentKey::TotalBorrowValue(asset.clone()))
        .unwrap_or(0u128)
}

pub fn set_total_borrow_value(env: &Env, asset: &Symbol, value: u128) {
    env.storage()
        .persistent()
        .set(&PersistentKey::TotalBorrowValue(asset.clone()), &value);
}

// --- R20 running Jubjub Pedersen aggregates ------------------------------

pub fn running_collateral_commit(env: &Env, asset: &Symbol) -> JubjubPoint {
    env.storage()
        .persistent()
        .get(&PersistentKey::RunningCollateralCommit(asset.clone()))
        .unwrap_or_else(|| JubjubPoint::identity(env))
}

pub fn set_running_collateral_commit(env: &Env, asset: &Symbol, point: &JubjubPoint) {
    env.storage().persistent().set(
        &PersistentKey::RunningCollateralCommit(asset.clone()),
        point,
    );
}

pub fn running_loan_commit(env: &Env, asset: &Symbol) -> JubjubPoint {
    env.storage()
        .persistent()
        .get(&PersistentKey::RunningLoanCommit(asset.clone()))
        .unwrap_or_else(|| JubjubPoint::identity(env))
}

pub fn set_running_loan_commit(env: &Env, asset: &Symbol, point: &JubjubPoint) {
    env.storage()
        .persistent()
        .set(&PersistentKey::RunningLoanCommit(asset.clone()), point);
}

// --- Interest accrual indices ------------------------------------------

pub fn borrow_index(env: &Env, asset: &Symbol) -> IndexSnapshot {
    env.storage()
        .persistent()
        .get(&PersistentKey::BorrowIndex(asset.clone()))
        .unwrap_or(IndexSnapshot {
            last_updated: 0,
            value: 1_000_000_000_000_000_000u128,
        })
}

pub fn set_borrow_index(env: &Env, asset: &Symbol, snapshot: &IndexSnapshot) {
    env.storage()
        .persistent()
        .set(&PersistentKey::BorrowIndex(asset.clone()), snapshot);
}

pub fn liquidity_index(env: &Env, asset: &Symbol) -> IndexSnapshot {
    env.storage()
        .persistent()
        .get(&PersistentKey::LiquidityIndex(asset.clone()))
        .unwrap_or(IndexSnapshot {
            last_updated: 0,
            value: 1_000_000_000_000_000_000u128,
        })
}

pub fn set_liquidity_index(env: &Env, asset: &Symbol, snapshot: &IndexSnapshot) {
    env.storage()
        .persistent()
        .set(&PersistentKey::LiquidityIndex(asset.clone()), snapshot);
}
