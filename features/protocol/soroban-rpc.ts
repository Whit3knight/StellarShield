export type SorobanSendResponse = {
  errorResult?: unknown
  errorResultXdr?: string
  hash: string
  status: "PENDING" | "DUPLICATE" | "TRY_AGAIN_LATER" | "ERROR"
}

export type SorobanGetResponse = {
  createdAt?: number
  status: "SUCCESS" | "FAILED" | "NOT_FOUND"
}

export type SorobanRpcClient = {
  getTransaction(hash: string): Promise<SorobanGetResponse>
  sendTransaction(input: {
    networkPassphrase: string
    signedXdr: string
  }): Promise<SorobanSendResponse>
}

export function createDefaultSorobanRpcClient(
  sorobanRpcUrl: string
): SorobanRpcClient {
  let cachedServer: unknown = null

  async function getServer() {
    if (cachedServer) return cachedServer
    const { rpc } = await import("@stellar/stellar-sdk")
    cachedServer = new rpc.Server(sorobanRpcUrl)
    return cachedServer
  }

  return {
    async sendTransaction({ networkPassphrase, signedXdr }) {
      const server = (await getServer()) as {
        sendTransaction: (tx: unknown) => Promise<SorobanSendResponse>
      }
      const { TransactionBuilder } = await import("@stellar/stellar-sdk")
      const transaction = TransactionBuilder.fromXDR(
        signedXdr,
        networkPassphrase
      )

      return server.sendTransaction(transaction)
    },
    async getTransaction(hash) {
      const server = (await getServer()) as {
        getTransaction: (hash: string) => Promise<SorobanGetResponse>
      }

      return server.getTransaction(hash)
    },
  }
}
