//! Soroban token client wrappers used by the shielded pool for
//! collateral custody + loan payout.
//!
//! Real deposits and withdrawals move actual token balances via the
//! standard `soroban_sdk::token::TokenClient` interface. Contract
//! must hold every collateral asset it accepts, so the token contract
//! addresses live in instance storage per asset (`Reserve(asset)`).

#![allow(dead_code)]

use soroban_sdk::{contracttype, token, vec, Address, Env, IntoVal, Symbol};

/// Instance-storage key mapping asset symbols to their SAC / Soroban
/// token contract addresses. Set at `initialize` alongside the
/// Reflector contract.
#[contracttype]
pub enum ReserveKey {
    Reserve(Symbol),
}

/// Register the token contract that manages `asset` on this network.
/// Admin-gated (caller must have already require_auth'd).
pub fn set_reserve(env: &Env, asset: &Symbol, token_contract: &Address) {
    env.storage()
        .instance()
        .set(&ReserveKey::Reserve(asset.clone()), token_contract);
}

pub fn reserve(env: &Env, asset: &Symbol) -> Option<Address> {
    env.storage()
        .instance()
        .get(&ReserveKey::Reserve(asset.clone()))
}

/// Pool's own current balance of `asset`, read straight from the SAC
/// — the same value a raw `transfer_out` would trap against on
/// shortfall. Raw `env.invoke_contract` rather than `token::Client`'s
/// typed wrapper: `.balance()` is a distinct host-call site from the
/// `.transfer()` calls below regardless of mechanism, and the typed
/// client's own dispatch macro measured larger here (see
/// docs/REMEDIATION.md R25).
pub fn available_balance(env: &Env, asset: &Symbol) -> i128 {
    let token_contract = reserve(env, asset)
        .expect("tokens::available_balance: reserve not registered for asset");
    let holder = env.current_contract_address();
    env.invoke_contract(
        &token_contract,
        &Symbol::new(env, "balance"),
        vec![env, holder.into_val(env)],
    )
}

/// Pull `amount` of `asset` from `from` into the contract's own balance.
/// Requires the caller to have require_auth'd. Amount is denominated
/// in the token's smallest unit (stroops for XLM classic tokens).
pub fn transfer_in(env: &Env, asset: &Symbol, from: &Address, amount: i128) {
    let token_contract = reserve(env, asset)
        .expect("tokens::transfer_in: reserve not registered for asset");
    let client = token::Client::new(env, &token_contract);
    client.transfer(from, &env.current_contract_address(), &amount);
}

/// Push `amount` of `asset` from the contract to `to`. Used by
/// `withdraw` and `liquidate` when releasing funds back to a wallet.
pub fn transfer_out(env: &Env, asset: &Symbol, to: &Address, amount: i128) {
    let token_contract = reserve(env, asset)
        .expect("tokens::transfer_out: reserve not registered for asset");
    let client = token::Client::new(env, &token_contract);
    client.transfer(&env.current_contract_address(), to, &amount);
}
