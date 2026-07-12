"use client"

import * as React from "react"

import { toastManager } from "@/components/ui/toast"
import {
  computeCommitment,
  DENOMINATION,
  deriveShieldedIdentity,
  encodeMemoBundle,
  encryptMemo,
  randomFieldElement,
  SUPPORTED_ASSETS,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import { fetchReflectorPrice } from "@/features/markets/prices"
import { getRiskParams } from "@/features/protocol/risk-params"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
  getStellarExpertTxUrl,
} from "@/features/wallet/network"

import { createToastTracker, describeError } from "./hook-utils"
import { proveLiquidate } from "./liquidate-prover"
import { proveLiquidateV2 } from "./liquidate-v2-prover"

type Status =
  | "idle"
  | "pricing"
  | "proving"
  | "signing"
  | "success"
  | "failed"

type UseLiquidateResult = {
  activeLoanIndex: number | null
  message: string | null
  reset: () => void
  status: Status
  liquidate: (loanNote: ShieldedNote) => Promise<{ txHash: string } | null>
}

/**
 * Trigger a shielded liquidation on a loan note whose memo openings
 * are available (borrower's own loan or a note handed to the caller
 * by the liquidation service). Fetches the current Reflector price,
 * asserts the position is underwater, generates the Groth16 proof,
 * signs + submits `liquidate_shielded`. No bounty payout in v1 —
 * successful liquidation just burns the loan nullifier so the borrower
 * can't claim the loan amount downstream.
 */
export function useLiquidate(
  account: string | null,
  walletSeed: Uint8Array | null
): UseLiquidateResult {
  const [status, setStatus] = React.useState<Status>("idle")
  const [message, setMessage] = React.useState<string | null>(null)
  const [activeLoanIndex, setActiveLoanIndex] = React.useState<number | null>(
    null
  )

  const reset = React.useCallback(() => {
    setStatus("idle")
    setMessage(null)
    setActiveLoanIndex(null)
  }, [])

  const liquidate = React.useCallback(
    async (loanNote: ShieldedNote) => {
      if (!account || !walletSeed) {
        setStatus("failed")
        setMessage("Connect a wallet first.")
        return null
      }
      if (loanNote.tree !== "loan" || !loanNote.bond) {
        setStatus("failed")
        setMessage("This loan has no liquidation bond (pre-Track-L borrow).")
        return null
      }

      const contractId = getConfiguredContractId()
      if (!contractId) {
        setStatus("failed")
        setMessage("Contract not configured.")
        return null
      }

      setActiveLoanIndex(loanNote.index)
      setMessage(null)

      const toast = createToastTracker()
      toast.set(
        toastManager.add({
          title: "Reading current price",
          description: "Fetching Reflector oracle for underwater check…",
          type: "loading",
        })
      )

      try {
        setStatus("pricing")
        const priceRecord = await fetchReflectorPrice(loanNote.asset)
        if (!priceRecord || priceRecord.price <= 0n) {
          throw new Error(
            `Reflector returned no price for ${loanNote.asset}. Retry when the feed refreshes.`
          )
        }
        const risk = await getRiskParams()

        const loanCommitment = computeCommitment({
          amount: loanNote.amount,
          asset: loanNote.asset,
          salt: loanNote.salt,
          sk: loanNote.sk,
        })
        const loanCommitmentBytes = bigintTo32Bytes(loanCommitment)

        const bindings = await import("@/features/protocol/bindings/borrow-pool")
        const client = new bindings.Client({
          contractId,
          networkPassphrase: getConfiguredNetworkPassphrase(),
          rpcUrl: getConfiguredSorobanRpcUrl(),
          publicKey: account,
        })

        // Look up the bond so we know which collateral asset this
        // loan was opened against — the bounty leaf lands on that
        // asset's deposit tree. Also fetch the LoanNullifier
        // sidecar; presence = post-Track-A bond → v2 path, absence
        // = grandfathered → v1 fallback.
        const [bondFetch, nullifierFetch] = await Promise.all([
          client.liquidation_bond({
            loan_commitment: Buffer.from(loanCommitmentBytes),
          }),
          client.loan_nullifier({
            loan_commitment: Buffer.from(loanCommitmentBytes),
          }),
        ])
        const bondOnChain = bondFetch.result
        if (!bondOnChain) {
          throw new Error("No liquidation bond found for this loan.")
        }
        const collateralAsset = SUPPORTED_ASSETS[
          Number(bondOnChain.collateral_asset_tag)
        ] as ShieldedAsset | undefined
        if (!collateralAsset) {
          throw new Error(
            `Unknown collateral asset tag ${bondOnChain.collateral_asset_tag.toString()}`
          )
        }
        const sidecarNullifier = nullifierFetch.result
        const useV2 = sidecarNullifier !== undefined && sidecarNullifier !== null

        toast.set(
          toastManager.add({
            title: `Generating liquidate ${useV2 ? "v2" : "v1"} proof`,
            description: "3 bond commits + underwater range check…",
            type: "loading",
          })
        )
        setStatus("proving")

        const nowSecs = BigInt(Math.floor(Date.now() / 1000))
        let proofBuffers
        if (useV2) {
          const proof = await proveLiquidateV2({
            loanAmount: loanNote.amount,
            bondSaltAmount: loanNote.bond.saltAmount,
            collateralNotional: loanNote.bond.collateralValue,
            bondSaltValue: loanNote.bond.saltValue,
            borrowPrice: loanNote.bond.borrowPrice,
            bondSaltPrice: loanNote.bond.saltPrice,
            currentPrice: priceRecord.price,
            thresholdBps: risk.liquidationThresholdBps,
          })
          proofBuffers = {
            a: Buffer.from(proof.a),
            b: Buffer.from(proof.b),
            c: Buffer.from(proof.c),
            oracle_epoch: nowSecs,
            public_signals: proof.publicSignals.map((bytes) =>
              bigintFromBytes(bytes)
            ),
          }
        } else {
          const proof = await proveLiquidate({
            loanAsset: loanNote.asset,
            loanAmount: loanNote.amount,
            loanSalt: loanNote.salt,
            loanIndex: loanNote.index,
            sk: loanNote.sk,
            bondSaltAmount: loanNote.bond.saltAmount,
            bondSaltValue: loanNote.bond.saltValue,
            bondSaltPrice: loanNote.bond.saltPrice,
            collateralNotional: loanNote.bond.collateralValue,
            borrowPrice: loanNote.bond.borrowPrice,
            currentPrice: priceRecord.price,
            thresholdBps: risk.liquidationThresholdBps,
          })
          proofBuffers = {
            a: Buffer.from(proof.a),
            b: Buffer.from(proof.b),
            c: Buffer.from(proof.c),
            oracle_epoch: nowSecs,
            public_signals: proof.publicSignals.map((bytes) =>
              bigintFromBytes(bytes)
            ),
          }
        }

        toast.set(
          toastManager.add({
            title: "Sign in wallet",
            description: `Approve liquidate_shielded${useV2 ? "_v2" : ""} in Freighter.`,
            type: "loading",
          })
        )
        setStatus("signing")

        // Generate a fresh liquidator note (Poseidon(denom, asset_tag,
        // sk, salt)). Fresh salt every time so bounties are
        // unlinkable across liquidations. Amount fixed at the
        // asset's denomination so the standard withdraw circuit
        // accepts the resulting deposit note.
        const liquidatorIdentity = deriveShieldedIdentity(walletSeed)
        const liquidatorSk = bytesToBigInt(liquidatorIdentity.secretKey)
        const bountySalt = randomFieldElement()
        const bountyAmount = DENOMINATION[collateralAsset]
        const bountyCommitment = computeCommitment({
          amount: bountyAmount,
          asset: collateralAsset,
          salt: bountySalt,
          sk: liquidatorSk,
        })
        const bountyMemo = encodeMemoBundle(
          encryptMemo({
            plaintext: {
              amount: bountyAmount.toString(),
              asset: collateralAsset,
              index: 0,
              salt: bountySalt.toString(),
              tree: "deposit",
            },
            recipientPk: liquidatorIdentity.publicKey,
          })
        )

        const assembled = useV2
          ? await client.liquidate_shielded_v2({
              liquidator: account,
              borrow_asset: loanNote.asset,
              collateral_asset: collateralAsset,
              loan_commitment: Buffer.from(loanCommitmentBytes),
              loan_nullifier: Buffer.from(sidecarNullifier as Uint8Array),
              proof: proofBuffers,
              bounty_commit: Buffer.from(bigintTo32Bytes(bountyCommitment)),
              bounty_memo: Buffer.from(bountyMemo),
            })
          : await client.liquidate_shielded({
              liquidator: account,
              borrow_asset: loanNote.asset,
              collateral_asset: collateralAsset,
              proof: proofBuffers,
              bounty_commit: Buffer.from(bigintTo32Bytes(bountyCommitment)),
              bounty_memo: Buffer.from(bountyMemo),
            })

        const { signTransaction: freighter } = await import(
          "@stellar/freighter-api"
        )
        const sent = await assembled.signAndSend({
          signTransaction: (async (
            xdrToSign: string,
            opts?: { address?: string; networkPassphrase?: string }
          ) => {
            return freighter(xdrToSign, {
              address: opts?.address ?? account,
              networkPassphrase:
                opts?.networkPassphrase ?? getConfiguredNetworkPassphrase(),
            })
          }) as unknown as Parameters<
            typeof assembled.signAndSend
          >[0] extends undefined
            ? never
            : NonNullable<
                Parameters<typeof assembled.signAndSend>[0]
              >["signTransaction"],
        })

        toast.close()

        const hash = sent.sendTransactionResponse?.hash ?? ""
        setStatus("success")
        setMessage(hash)
        toastManager.add({
          title: `Liquidated loan #${loanNote.index}`,
          description: "Nullifier posted, pool retains collateral.",
          type: "success",
          timeout: 6_000,
          actionProps: {
            children: "View Transaction",
            onClick: () => window.open(getStellarExpertTxUrl(hash), "_blank"),
          },
        })
        return { txHash: hash }
      } catch (cause) {
        toast.close()
        const { title, description, rejected } = describeError(
          cause,
          "Liquidate failed"
        )
        setStatus("failed")
        setMessage(description)
        toastManager.add({
          title,
          description,
          type: rejected ? "info" : "error",
          timeout: 8_000,
        })
        return null
      }
    },
    [account, walletSeed]
  )

  return { activeLoanIndex, message, reset, status, liquidate }
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}

function bigintTo32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let residue = value
  for (let index = 31; index >= 0; index--) {
    out[index] = Number(residue & 0xffn)
    residue >>= 8n
  }
  return out
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
