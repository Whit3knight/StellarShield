export type StellarNetwork = "public" | "testnet" | "futurenet"

type StellarNetworkConfig = {
  horizonUrl: string
  label: string
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
  },
  public: {
    horizonUrl: "https://horizon.stellar.org",
    label: "Public",
  },
  testnet: {
    horizonUrl: "https://horizon-testnet.stellar.org",
    label: "Testnet",
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

export function getStellarExpertAccountUrl(address: string): string {
  const network = getConfiguredStellarNetwork()
  const path = network === "public" ? "public" : network

  return `https://stellar.expert/explorer/${path}/account/${address}`
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
