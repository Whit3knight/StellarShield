//! Interest rate curve + linear index accrual.
//!
//! Contract stores per-asset `IndexSnapshot`s. Every borrow / repay
//! calls `accrue_borrow_index()` before doing anything else so the
//! index reflects the seconds since last update. Aggregate borrow /
//! supply state is public (event-derived on the frontend), which
//! doesn't leak per-user amounts but does let us drive an Aave-style
//! curve.
//!
//! Fixed-point scale: 1e18. `1_000_000_000_000_000_000` = 1.0.

#![allow(dead_code)]

use soroban_sdk::{Env, Symbol};

use crate::state::{
    self, IndexSnapshot, RateParams,
};

pub const ONE_E18: u128 = 1_000_000_000_000_000_000;
const BPS_DENOMINATOR: u128 = 10_000;

/// Utilization (as a 1e18 fixed-point ratio) from `total_borrow` and
/// `total_deposit`. Zero deposit → zero utilization to keep the rate
/// curve producing the base APR.
pub fn utilization(env: &Env, asset: &Symbol) -> u128 {
    let borrow = state::total_borrow(env, asset);
    let deposit = state::total_deposit(env, asset);
    if deposit == 0 || borrow == 0 {
        return 0;
    }
    // `borrow / (deposit + borrow)` in 1e18 fixed point.
    let denom = deposit
        .checked_add(borrow)
        .expect("utilization: denominator overflow");
    borrow
        .checked_mul(ONE_E18)
        .expect("utilization: mul overflow")
        / denom
}

/// Instant borrow APR in 1e18 fixed point. Matches
/// `deriveMarketMetrics` on the frontend.
pub fn borrow_rate(params: &RateParams, utilization_1e18: u128) -> u128 {
    let base = (params.base_apr_bps as u128) * ONE_E18 / BPS_DENOMINATOR;
    let slope_term = (params.slope_apr_bps as u128)
        .checked_mul(utilization_1e18)
        .expect("borrow_rate: overflow")
        / BPS_DENOMINATOR;
    base + slope_term
}

/// Supply APY approximation `borrowRate × U × (1 - reserveFactor)`.
pub fn supply_rate(
    params: &RateParams,
    utilization_1e18: u128,
    borrow_rate_1e18: u128,
) -> u128 {
    let after_reserve = (BPS_DENOMINATOR - params.reserve_factor_bps as u128)
        * ONE_E18
        / BPS_DENOMINATOR;
    borrow_rate_1e18
        .checked_mul(utilization_1e18)
        .expect("supply_rate: overflow")
        / ONE_E18
        * after_reserve
        / ONE_E18
}

/// Advance a running index by `seconds_elapsed` at `rate_1e18` per
/// year. Linear approximation (no compounding within the epoch) —
/// good enough for MVP; upgrade to per-second compound in Phase 3.
pub fn linear_accrue(
    snapshot: IndexSnapshot,
    rate_1e18: u128,
    now: u64,
    seconds_per_year: u32,
) -> IndexSnapshot {
    if snapshot.last_updated == 0 || snapshot.last_updated >= now {
        return IndexSnapshot {
            last_updated: now,
            value: if snapshot.value == 0 {
                ONE_E18
            } else {
                snapshot.value
            },
        };
    }
    let delta = now - snapshot.last_updated;
    let growth = rate_1e18
        .checked_mul(delta as u128)
        .expect("accrue: growth overflow")
        / (seconds_per_year as u128);
    let value = snapshot
        .value
        .checked_mul(ONE_E18 + growth)
        .expect("accrue: value overflow")
        / ONE_E18;
    IndexSnapshot {
        last_updated: now,
        value,
    }
}

/// Update the on-chain borrow index for `asset`. Callers are the
/// state-mutating operations (borrow / repay / liquidate).
pub fn accrue_borrow_index(env: &Env, asset: &Symbol) -> IndexSnapshot {
    let params = state::rate_params(env)
        .expect("accrue: rate params must be initialised");
    let snapshot = state::borrow_index(env, asset);
    let util = utilization(env, asset);
    let rate = borrow_rate(&params, util);
    let now = env.ledger().timestamp();
    let next = linear_accrue(snapshot, rate, now, params.seconds_per_year);
    state::set_borrow_index(env, asset, &next);
    next
}

/// Update the on-chain liquidity (supply) index for `asset`.
pub fn accrue_liquidity_index(env: &Env, asset: &Symbol) -> IndexSnapshot {
    let params = state::rate_params(env)
        .expect("accrue: rate params must be initialised");
    let snapshot = state::liquidity_index(env, asset);
    let util = utilization(env, asset);
    let borrow_rate_now = borrow_rate(&params, util);
    let rate = supply_rate(&params, util, borrow_rate_now);
    let now = env.ledger().timestamp();
    let next = linear_accrue(snapshot, rate, now, params.seconds_per_year);
    state::set_liquidity_index(env, asset, &next);
    next
}
