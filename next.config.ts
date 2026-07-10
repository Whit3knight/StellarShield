import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "@base-ui/react"],
  },
  async headers() {
    // Barretenberg (Noir prover backend) needs SharedArrayBuffer, which
    // requires cross-origin isolation. Without these headers the WASM
    // instantiates but the multithreaded verifier path throws at load,
    // which is why "verify eligibility" appears silent in the browser.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ]
  },
}

export default nextConfig
