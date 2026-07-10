export type StellarNetwork = "public" | "testnet" | "futurenet"

type StellarNetworkConfig = {
  horizonUrl: string
  label: string
  networkPassphrase: string
  sorobanRpcUrl: string
}

type FreighterNetworkDetails = {
  network?: string
  networkPassphrase?: string
  networkUrl?: string
}

const DEFAULT_STELLAR_NETWORK: StellarNetwork = "testnet"

const STELLAR_NETWORKS: Record<StellarNetwork, StellarNetworkConfig> = {
  futurenet: {
    horizonUrl: "https://horizon-futurenet.stellar.org",
    label: "Futurenet",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
  },
  public: {
    horizonUrl: "https://horizon.stellar.org",
    label: "Public",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    sorobanRpcUrl: "https://mainnet.sorobanrpc.com",
  },
  testnet: {
    horizonUrl: "https://horizon-testnet.stellar.org",
    label: "Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  },
}

export function getConfiguredStellarNetwork(): StellarNetwork {
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK?.toLowerCase()

  if (network === "public" || network === "mainnet" || network === "pubnet") {
    return "public"
  }

  if (network === "futurenet") {
    return "futurenet"
  }

  return DEFAULT_STELLAR_NETWORK
}

export function getConfiguredNetworkLabel(): string {
  return STELLAR_NETWORKS[getConfiguredStellarNetwork()].label
}

export function getConfiguredHorizonUrl(): string {
  const horizonUrl = process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL?.trim()

  if (horizonUrl) {
    return horizonUrl.replace(/\/$/, "")
  }

  return STELLAR_NETWORKS[getConfiguredStellarNetwork()].horizonUrl
}

export function getConfiguredSorobanRpcUrl(): string {
  const rpcUrl = process.env.NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL?.trim()

  if (rpcUrl) {
    return rpcUrl.replace(/\/$/, "")
  }

  return STELLAR_NETWORKS[getConfiguredStellarNetwork()].sorobanRpcUrl
}

export function getConfiguredNetworkPassphrase(): string {
  return STELLAR_NETWORKS[getConfiguredStellarNetwork()].networkPassphrase
}

export function getConfiguredContractId(): string | null {
  const contractId =
    process.env.NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID?.trim() ?? ""

  return contractId.length > 0 ? contractId : null
}

export function getStellarExpertAccountUrl(address: string): string {
  const network = getConfiguredStellarNetwork()
  const path = network === "public" ? "public" : network

  return `https://stellar.expert/explorer/${path}/account/${address}`
}

export function getStellarExpertTxUrl(hash: string): string {
  const network = getConfiguredStellarNetwork()
  const path = network === "public" ? "public" : network

  return `https://stellar.expert/explorer/${path}/tx/${hash}`
}

export function isFreighterNetworkCompatible(
  networkDetails: FreighterNetworkDetails
): boolean {
  const network = getConfiguredStellarNetwork()
  const freighterNetwork = [
    networkDetails.network,
    networkDetails.networkPassphrase,
    networkDetails.networkUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (!freighterNetwork) {
    return true
  }

  if (network === "public") {
    return (
      freighterNetwork.includes("public") ||
      freighterNetwork.includes("mainnet") ||
      freighterNetwork.includes("pubnet") ||
      freighterNetwork.includes("horizon.stellar.org")
    )
  }

  if (network === "futurenet") {
    return freighterNetwork.includes("future")
  }

  return freighterNetwork.includes("test")
}
