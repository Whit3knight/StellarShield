//! Minimal Reflector (SEP-40) price-oracle client. R17: `borrow_shielded`
//! needs a REAL price to size a dynamic borrow cap — before this file,
//! nothing in the contract ever called Reflector at all. `state::reflector`
//! stored an address but no cross-contract call existed anywhere.
//!
//! Scope: CEX feed only, matching the address actually stored at
//! `initialize_shielded` (`docs/deployment.md`'s init argument is byte-
//! identical to `NEXT_PUBLIC_STELLAR_REFLECTOR_CEX_CONTRACT_ID`, not the
//! FX id). Covers XLM/USDC, the only live market today. EURC/FX pricing
//! is a follow-up when that market activates — this deliberately does
//! not try to solve a two-feed problem for a market that isn't live.
//!
//! `Asset`/`PriceData` shapes and the `lastprice`/`decimals` interface
//! mirror `features/markets/prices.ts`'s already-proven-working calls
//! (`Asset::Other(ticker)`, `PriceData { price: i128, timestamp: u64 }`) —
//! not invented here. Reflector's own contract is a separate deployment
//! this crate doesn't control; its real `Asset` enum also has a
//! `Stellar(Address)` variant, omitted here since this module only ever
//! constructs `Other`. Soroban's `#[contracttype]` encodes data-carrying
//! enum variants by NAME (a leading `Symbol` tag), not positional index,
//! so a client-side subset of the real enum's variants round-trips fine
//! as long as the variants it does declare keep their real names.

#![allow(dead_code)]

use soroban_sdk::{contractclient, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contractclient(name = "ReflectorClient")]
pub trait ReflectorInterface {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
    fn decimals(env: Env) -> u32;
}

/// Live-read a Reflector price for `ticker` (e.g. "XLM", "USDC").
/// Returns `None` on any failure — no feed record, stale contract,
/// whatever — so the caller can fail closed rather than borrow a
/// possibly-stale/absent price. Fetches `decimals()` fresh every call
/// (no cache — this is a single contract-side read per borrow, not a
/// hot path like the frontend's repeated UI refreshes) rather than
/// assume the commonly-seen value of 14, mirroring `prices.ts`'s own
/// "don't hardcode it" discipline.
pub fn fetch_price(
    env: &Env,
    reflector_contract: &Address,
    ticker: &Symbol,
) -> Option<(PriceData, u32)> {
    let client = ReflectorClient::new(env, reflector_contract);
    let price = client.lastprice(&Asset::Other(ticker.clone()))?;
    let decimals = client.decimals();
    Some((price, decimals))
}

/// 1e14-scaled ratio: one raw `collateral` unit priced in raw `borrow`
/// units. MUST replicate `features/markets/prices.ts`'s `fetchPriceRatio`
/// formula exactly (live feed-decimals delta + token-decimals delta,
/// not a hardcoded 14) — a second implementation of this formula
/// diverging from the frontend's is exactly the raw-vs-whole-unit bug
/// class commit `09471e9` already shipped once. Cross-checked directly
/// against `prices.ts` for a live read in Phase 1's verification step
/// (see docs plan) before this is trusted in production.
///
/// `collateral_decimals`/`borrow_decimals` are the ASSET's own decimal
/// places (7 for XLM/USDC/EURC today — read from `notes::` rather than
/// hardcoded here, by the caller).
pub fn price_ratio(
    env: &Env,
    reflector_contract: &Address,
    collateral_ticker: &Symbol,
    borrow_ticker: &Symbol,
    collateral_token_decimals: i32,
    borrow_token_decimals: i32,
) -> Option<i128> {
    if collateral_ticker == borrow_ticker {
        // Same-asset market: ratio is exactly 1.0 at 1e14 scale, same
        // short-circuit prices.ts takes.
        return Some(100_000_000_000_000i128);
    }

    let (collateral_price, collateral_decimals) =
        fetch_price(env, reflector_contract, collateral_ticker)?;
    let (borrow_price, borrow_decimals) =
        fetch_price(env, reflector_contract, borrow_ticker)?;

    if collateral_price.price <= 0 || borrow_price.price <= 0 {
        return None;
    }

    // exponent = 14 + (borrow_feed_decimals - collateral_feed_decimals)
    //               + (borrow_token_decimals - collateral_token_decimals)
    let exponent: i32 = 14
        + (borrow_decimals as i32 - collateral_decimals as i32)
        + (borrow_token_decimals - collateral_token_decimals);

    if exponent >= 0 {
        let scale = pow10(exponent as u32)?;
        collateral_price.price.checked_mul(scale)?.checked_div(borrow_price.price)
    } else {
        let scale = pow10((-exponent) as u32)?;
        let denom = borrow_price.price.checked_mul(scale)?;
        if denom == 0 {
            return None;
        }
        collateral_price.price.checked_div(denom)
    }
}

/// `10^exp` as an `i128`, `None` on overflow. Exponents in practice
/// stay well under 30 (14 base + small per-asset decimal deltas), far
/// under i128's ~38-digit range, but this stays defensive rather than
/// assume the caller's inputs are always sane.
fn pow10(exp: u32) -> Option<i128> {
    10i128.checked_pow(exp)
}
