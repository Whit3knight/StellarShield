import {
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Public key used only to satisfy TransactionBuilder for read-only
// `simulateTransaction`. Preflight ignores account existence — no funds
// required. This is the all-zeros ed25519 address (StrKey.encode of 32
// zero bytes); it must be a checksum-valid strkey or `new Account()`
// throws "accountId is invalid". Same constant `prices.ts` uses.
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

/**
 * Raw SEP-41 `balance(id: Address) -> i128` read against an arbitrary
 * token contract — no pre-generated bindings needed, mirrors
 * `fetchReflectorPrice`'s pattern for the same reason (Reflector and
 * the per-asset reserve SACs are both foreign contracts this repo
 * doesn't control). Ground truth for "how much of this asset does the
 * pool actually hold right now" — unlike `total_deposit_value` minus
 * `total_borrow_value`, this can't drift: it's the SAC's own ledger
 * state, not a counter the contract has to remember to update.
 */
export async function fetchTokenBalance(
  tokenContractId: string,
  holderAddress: string,
  signal?: AbortSignal
): Promise<bigint | null> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const sdk = await import("@stellar/stellar-sdk")
  const { rpc } = await import("@stellar/stellar-sdk")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const rpcUrl = getConfiguredSorobanRpcUrl()
  const server = new rpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  })
  const source = new sdk.Account(SIMULATION_SOURCE, "0")
  const contract = new sdk.Contract(tokenContractId)

  const tx = new sdk.TransactionBuilder(source, {
    fee: sdk.BASE_FEE,
    networkPassphrase: getConfiguredNetworkPassphrase(),
  })
    .addOperation(
      contract.call("balance", new sdk.Address(holderAddress).toScVal())
    )
    .setTimeout(30)
    .build()

  let sim
  try {
    sim = await server.simulateTransaction(tx)
  } catch {
    return null
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  if (rpc.Api.isSimulationError(sim)) return null

  const retval = sim.result?.retval
  if (!retval) return null

  const native = sdk.scValToNative(retval) as bigint | number
  return typeof native === "bigint" ? native : BigInt(native)
}
