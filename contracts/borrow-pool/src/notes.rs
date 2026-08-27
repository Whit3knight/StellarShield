//! Shielded note conventions shared between contract-side note
//! validation and cross-checks with the client's `features/notes`
//! module.
//!
//! - Assets: XLM, USDC, EURC. Tag is the position in
//!   `SUPPORTED_ASSETS` so the circuit can constrain "tag == index of
//!   asset symbol" cheaply.
//! - Denomination: fixed per asset, in RAW token units (stroops). All
//!   three SACs are 7-decimal, so 1 XLM = 10_000_000. Contract enforces
//!   on every `deposit` that the transferred token amount equals this
//!   constant.

#![allow(dead_code)]

use soroban_sdk::{Env, Symbol};

pub const ASSET_XLM: u32 = 0;
pub const ASSET_USDC: u32 = 1;
pub const ASSET_EURC: u32 = 2;

/// Denomination in RAW token units (stroops, 7 decimals) — the value
/// actually moved by `token::transfer`. Matches `DENOMINATION` in
/// `features/notes/note.ts` and the fixed value the circuit expects.
/// 1 XLM, 0.5 USDC, 0.5 EURC.
pub const DENOMINATION_XLM: i128 = 10_000_000;
pub const DENOMINATION_USDC: i128 = 5_000_000;
pub const DENOMINATION_EURC: i128 = 5_000_000;

/// Numeric asset tag matching the JS-side `assetTag` helper.
pub fn asset_tag(env: &Env, symbol: &Symbol) -> Option<u32> {
    if symbol == &Symbol::new(env, "XLM") {
        Some(ASSET_XLM)
    } else if symbol == &Symbol::new(env, "USDC") {
        Some(ASSET_USDC)
    } else if symbol == &Symbol::new(env, "EURC") {
        Some(ASSET_EURC)
    } else {
        None
    }
}

/// Fixed denomination per asset (raw token units, i128 for Soroban
/// token clients).
pub fn denomination(env: &Env, symbol: &Symbol) -> Option<i128> {
    if symbol == &Symbol::new(env, "XLM") {
        Some(DENOMINATION_XLM)
    } else if symbol == &Symbol::new(env, "USDC") {
        Some(DENOMINATION_USDC)
    } else if symbol == &Symbol::new(env, "EURC") {
        Some(DENOMINATION_EURC)
    } else {
        None
    }
}

/// Token decimal places (matches each SAC's real decimals AND
/// `features/markets/data.ts`'s `assets` map — all three are 7 today).
/// R17: kept as an explicit per-asset lookup (not folded into a shared
/// constant) so `reflector::price_ratio`'s formula stays parameterized —
/// the same discipline `features/markets/prices.ts`'s own comment
/// documents ("keeping them visible is what stops a 6-decimal asset
/// from silently re-breaking borrow sizing").
pub fn decimals(env: &Env, symbol: &Symbol) -> Option<i32> {
    if symbol == &Symbol::new(env, "XLM")
        || symbol == &Symbol::new(env, "USDC")
        || symbol == &Symbol::new(env, "EURC")
    {
        Some(7)
    } else {
        None
    }
}
