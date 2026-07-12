//! Precomputed zero-subtree hashes for the incremental Merkle tree.
//!
//! `ZERO_HASHES[0]` = `Fr::zero()`;
//! `ZERO_HASHES[i]` = `Poseidon(ZERO_HASHES[i-1], ZERO_HASHES[i-1])`.
//!
//! Recomputing these on every `deposit_shielded` / `borrow_shielded`
//! call blows the network CPU budget — each level is a Poseidon(2)
//! permutation over BLS12-381 Fr host fns, and 21 of them together
//! easily exceed the network's per-tx instruction limit. Hardcoding
//! the constants keeps `zero_hashes()` at zero host-fn cost.
//!
//! Generated from `features/notes/merkle.ts::zeroHashes()` — regen if
//! Poseidon constants or the tree depth ever change.

pub const DEPTH: usize = 20;

pub const ZERO_HASHES: [[u8; 32]; DEPTH + 1] = [
    hex_to_bytes("0000000000000000000000000000000000000000000000000000000000000000"),
    hex_to_bytes("33946da114adb989a601699e1137a0dfa343ad2033c932993971236ec03b1ec0"),
    hex_to_bytes("2c634f9736bf55163c54523f42c95d2fc60a29a1b42b678c603e4e688e78da60"),
    hex_to_bytes("3a767547034b6a8acabf271b9156f5aea5d4271d0bae8a9253780d10d298836e"),
    hex_to_bytes("0160b2b99abf7bef3b299a3a253052c1d2ec4ffb0aaa49acb3de21f6a4798051"),
    hex_to_bytes("5772e31f604aaa65f3581df1d1e7e885e3d7bfed02edfd4b0a0811727ab712a1"),
    hex_to_bytes("569162c40bdfbac1fbedf494b54f4e5f6a619b354df556d80ec387f07e3c3be3"),
    hex_to_bytes("2d10324228496b6db8f7dd8c39eb5f8274be53f46e44dd7a219e76c3041d4234"),
    hex_to_bytes("255014cec061c5518ed7836c1b5dfbd6553274271bb04d5fbb62ca39c95b1fe9"),
    hex_to_bytes("63dda167c8e5db65e0ba9b9c7734774ba333066d40ac79e4fc2a8f8b6dc901b4"),
    hex_to_bytes("4caea610ce3a2598a41fb6f0ded7b7467817c379a55f874ccc933d25f82e140a"),
    hex_to_bytes("64c3964a796e8dae25fad13a52a2a503ae42a77a44464cda149d22fffda07e67"),
    hex_to_bytes("6e794c48b1bd013f72bb739e9b12e1a19f2b24993885d1e0c6567bfb9c0f75d4"),
    hex_to_bytes("19e24eb10d5ccbd9466827a4aa54fbd38d0002ab81953d19f9801dc85b2480da"),
    hex_to_bytes("5372b664f6ef549eeb23e73c172369382e4d1c06a40a039920d80755aa16b888"),
    hex_to_bytes("62f719c05ece3f5d25ccd4d51d362364ade85ab086c4fb20447452633d721786"),
    hex_to_bytes("2f5ad2b5a1d6d48025c9a34df4e7d075827c410111a9279cedcae66b547046b0"),
    hex_to_bytes("3f685f416d018f6c11cb30e76ab135b1b3e843e7a32cacb5b1ee8085c1d1571e"),
    hex_to_bytes("26284e6df50119862d29e822f26f4e1670fcb5f235adc8028b62609dcdba28be"),
    hex_to_bytes("3e33e97c2754c383c18e40eeee3b1de27cf45a8ba46977ab4f8eecd95bebf58a"),
    hex_to_bytes("13098f7b02adf61c88b8685bbcf0eed27daeec1ef59824ee9a4afa7aa1b06fce"),
];

const fn hex_to_bytes(hex: &str) -> [u8; 32] {
    let bytes = hex.as_bytes();
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = (hex_nibble(bytes[i * 2]) << 4) | hex_nibble(bytes[i * 2 + 1]);
        i += 1;
    }
    out
}

const fn hex_nibble(b: u8) -> u8 {
    match b {
        b'0'..=b'9' => b - b'0',
        b'a'..=b'f' => b - b'a' + 10,
        b'A'..=b'F' => b - b'A' + 10,
        _ => 0,
    }
}
