//! Thin cross-contract client for `borrow-cap-helper` (R17 split — see
//! docs/REMEDIATION.md R17). Replaces the old in-process `reflector.rs`
//! call; the actual Reflector client code now lives in the helper
//! contract, not here.

#![allow(dead_code)]

use soroban_sdk::{contractclient, Address, Env, Symbol};

#[contractclient(name = "BorrowCapHelperClient")]
pub trait BorrowCapHelperInterface {
    fn dynamic_borrow_cap(
        env: Env,
        reflector_contract: Address,
        collateral_ticker: Symbol,
        borrow_ticker: Symbol,
        collateral_token_decimals: i32,
        borrow_token_decimals: i32,
        total_collateral_amount: i128,
        max_ltv_bps: u32,
    ) -> Option<i128>;
}
