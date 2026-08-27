#![no_std]

//! R17: split out of `borrow-pool` so calls that never need a live
//! price read (deposit/withdraw/repay) don't pay to parse
//! `reflector.rs`'s cross-contract-client code on every invocation —
//! Soroban charges WASM parse/instantiate cost per contract-code-hash
//! in a transaction's footprint, on the whole module, regardless of
//! which exported function is actually called. `borrow_shielded` and
//! `liquidate_shielded{,_v2}` are the only callers. Stateless: the
//! caller (`borrow-pool`) passes the Reflector address it trusts on
//! every call rather than this contract storing its own copy, so
//! there's no `initialize`/admin surface here at all.
//!
//! R22 cleanup: this contract originally also exposed
//! `dynamic_borrow_cap` (R17's own LTV/cap math), superseded by R20
//! moving that check into the borrow circuit itself — removed here
//! once nothing called it anymore (see docs/REMEDIATION.md R20/R22).

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

mod reflector;

#[contract]
pub struct BorrowCapHelper;

#[contractimpl]
impl BorrowCapHelper {
    /// Raw 1e14-scaled price ratio, no LTV/cap math applied. Lets
    /// `borrow-pool` cross-check its circuit's now-public `oracle_price`
    /// signal against a live Reflector read, instead of trusting the
    /// prover's own number (which is what made the LTV band decorative
    /// pre-R20 — see docs/REMEDIATION.md R20).
    pub fn price_ratio(
        env: Env,
        reflector_contract: Address,
        collateral_ticker: Symbol,
        borrow_ticker: Symbol,
        collateral_token_decimals: i32,
        borrow_token_decimals: i32,
    ) -> Option<i128> {
        reflector::price_ratio(
            &env,
            &reflector_contract,
            &collateral_ticker,
            &borrow_ticker,
            collateral_token_decimals,
            borrow_token_decimals,
        )
    }
}
