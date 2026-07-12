//! Precomputed zero-subtree hashes for the incremental Merkle tree.
//!
//! `ZERO_HASHES[0]` = `Fr::zero()`;
//! `ZERO_HASHES[i]` = `Poseidon(ZERO_HASHES[i-1], ZERO_HASHES[i-1])`.
//!
//! Regenerated whenever the Poseidon parameters change — the
//! source of truth is `features/notes/poseidon.ts`.

use crate::merkle::DEPTH;

#[inline]
const fn hex_to_bytes(s: &str) -> [u8; 32] {
    let bytes = s.as_bytes();
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        let hi = hex_nibble(bytes[i * 2]);
        let lo = hex_nibble(bytes[i * 2 + 1]);
        out[i] = (hi << 4) | lo;
        i += 1;
    }
    out
}

#[inline]
const fn hex_nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        b'A'..=b'F' => byte - b'A' + 10,
        _ => 0,
    }
}

pub const ZERO_HASHES: [[u8; 32]; DEPTH + 1] = [
    hex_to_bytes("0000000000000000000000000000000000000000000000000000000000000000"),
    hex_to_bytes("6c2bac92f1ffd53ea9c3166480d221f6d8b716ce67ba22b751781cbd305bfc7b"),
    hex_to_bytes("6c5c43bd280a41f3cf052601f5f04681f4a46f494248244fb9f02ba0fc13e992"),
    hex_to_bytes("23b5902987a2e16f5f65cfd3aca7ab9fd30a96f0201108eee6a840a7a0c6b1dc"),
    hex_to_bytes("0fe5437fa39d3f737bd90712346070b2b2f6efd41048089c757ca5bce82cdd0e"),
    hex_to_bytes("68d1bdb26377ba3e11cb6bbb313eb167366ce22f9c4a8a16a92849c51da4d0b3"),
    hex_to_bytes("4b793aba5e3621207b614ff7185da64d7558ce4d5406eae21d6aa8ae5035c10a"),
    hex_to_bytes("0e5da84a34c506465ddd6842d1a4de891224981c142bac69cdb6c8f3fddaae8f"),
    hex_to_bytes("19e5c211023fe56333260a8e8c650031f2c826b0e63b92fb1d3c5824b8e08bf6"),
    hex_to_bytes("1936800cc267476ff6570ca1a3da3f845fafed1d9b2a0e437168797c3c79cdbf"),
    hex_to_bytes("4d04b001c9fbc95d32c6901f8b60345c9ebb32e21b831ed42bf8d61b7cec5a6b"),
    hex_to_bytes("12ca4315d2a3593ee7da02ce2b5b8e9fcbc6018c5b172552ad2b0b21b1ab37de"),
    hex_to_bytes("538d44224aa00f09a69f7447a5dd1a7e29157bbeb2d2e28742b3f19d22eebc12"),
    hex_to_bytes("2093d1288e62deef88455e93af4e4126a562d107cacf1a73c0e2f50624dba1cf"),
    hex_to_bytes("16467e91c62decd33c5a97981bdba442f28c2facf0f9f0717ad12b9faa6ba86a"),
    hex_to_bytes("2620f0b0fb5925f0d593a158390daf69b5308e3d019df1ab4b36e78b9b1778ec"),
    hex_to_bytes("34891da709c2bda8e0a5e2858faa9886641b836d6b9b36798227b2d2e12f1d30"),
    hex_to_bytes("01db9d318a2322d74cc608c800fc39d5453f9347cff64897c650cdab13fd9e05"),
    hex_to_bytes("5b7b74e331f24ad91ab9ea71b254b9951683ef990bba5a369a4cc6ff199a9091"),
    hex_to_bytes("56b57fb3cf03255f741f03411b129c5c6ed7ad81d8aa38bb1219ca04e50e0d09"),
    hex_to_bytes("500d7edac24935fb5738441c8f3778bcb71449c552c756383dc986dc499d6322"),
];
