//! Typed storage layout for the shielded lending pool.
//!
//! All persistent state lives here. Every read + write goes through
//! typed getters/setters so the storage keys never leak into business
//! logic. Instance storage for tiny admin data (Admin address, params,
//! Reflector contract); persistent storage for anything that grows
//! (markets, per-asset tree state, nullifier set, indices).

#![allow(dead_code)]

use soroban_sdk::{contracttype, Address, BytesN, Env, Symbol, Vec};

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
    Nullifier(BytesN<32>),
    BorrowIndex(Symbol),
    LiquidityIndex(Symbol),
    TotalDeposit(Symbol),
    TotalBorrow(Symbol),
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

pub fn nullifier_used(env: &Env, nullifier: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&PersistentKey::Nullifier(nullifier.clone()))
}

pub fn mark_nullifier_used(env: &Env, nullifier: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&PersistentKey::Nullifier(nullifier.clone()), &true);
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
