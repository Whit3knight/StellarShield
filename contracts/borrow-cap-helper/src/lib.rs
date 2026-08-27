#![no_std]

//! R17: split out of `borrow-pool` so calls that never need a dynamic
//! borrow cap (deposit/withdraw/repay/liquidate) don't pay to parse
//! `reflector.rs`'s cross-contract-client code on every invocation —
//! Soroban charges WASM parse/instantiate cost per contract-code-hash
//! in a transaction's footprint, on the whole module, regardless of
//! which exported function is actually called. Only `borrow_shielded`
//! ever needs this. Stateless: the caller (`borrow-pool`) passes the
//! Reflector address it trusts on every call rather than this contract
//! storing its own copy, so there's no `initialize`/admin surface here
//! at all.

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

mod reflector;

#[contract]
pub struct BorrowCapHelper;

#[contractimpl]
impl BorrowCapHelper {
    /// Price-aware borrow cap from REAL, honest collateral (the
    /// caller's circuit-proven raw amount, no price factor baked in by
    /// the prover) times a price this contract reads itself from
    /// Reflector. Returns `None` if Reflector has no live feed for
    /// either leg — the caller falls back to its own flat cap.
    pub fn dynamic_borrow_cap(
        env: Env,
        reflector_contract: Address,
        collateral_ticker: Symbol,
        borrow_ticker: Symbol,
        collateral_token_decimals: i32,
        borrow_token_decimals: i32,
        total_collateral_amount: i128,
        max_ltv_bps: u32,
    ) -> Option<i128> {
        let ratio = reflector::price_ratio(
            &env,
            &reflector_contract,
            &collateral_ticker,
            &borrow_ticker,
            collateral_token_decimals,
            borrow_token_decimals,
        )?;
        if ratio <= 0 {
            return None;
        }

        const RATIO_SCALE: i128 = 100_000_000_000_000; // 1e14
        let collateral_value_in_borrow_units = total_collateral_amount
            .checked_mul(ratio)?
            .checked_div(RATIO_SCALE)?;

        let with_ltv = collateral_value_in_borrow_units
            .checked_mul(max_ltv_bps as i128)?
            .checked_div(10_000)?;
        with_ltv.checked_mul(9_500)?.checked_div(10_000)
    }
}
