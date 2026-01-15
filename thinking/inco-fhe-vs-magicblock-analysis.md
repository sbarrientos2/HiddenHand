# Inco FHE vs MagicBlock ER for Poker Privacy

> Analysis Date: January 2026
> Context: Evaluating true cryptographic privacy options for HiddenHand poker game

## Executive Summary

| Aspect | MagicBlock ER (Current) | Inco FHE (Alternative) |
|--------|------------------------|------------------------|
| **Privacy Model** | Execution-based (TEE) | Cryptographic (FHE) |
| **Trust Assumption** | Trust MagicBlock operators | Trust math (cryptographic guarantees) |
| **Status** | Production-ready | Beta (Solana devnet) |
| **Toolchain** | Works with current Anchor | Requires edition2024 (blocked) |
| **Performance** | Fast (~400ms slots) | Slower (FHE overhead) |
| **Card Shuffling** | VRF + ER execution | `e_rand()` encrypted randomness |
| **Privacy Guarantee** | "Can't see" (obscured) | "Can't compute" (encrypted) |

---

## Inco's Technology Stack

Based on [Inco's documentation](https://docs.inco.org/svm/home) and [architecture overview](https://www.inco.org/blog/introducing-inco-the-modular-confidential-computing-network):

### 1. TFHE (Torus Fully Homomorphic Encryption)
- Licensed from [Zama](https://www.zama.ai/)
- Allows **computations directly on encrypted data**
- Results remain encrypted until authorized decryption
- "Programmable bootstrapping" enables deep computation chains

### 2. Encrypted Types for Solana
```rust
// Available on Solana (via CPI to Inco Lightning program)
Euint128  // 128-bit encrypted integers
Ebool     // Encrypted booleans
```

### 3. Operations on Encrypted Data
| Category | Operations |
|----------|------------|
| Arithmetic | `e_add`, `e_sub`, `e_mul`, `e_rem` |
| Comparison | `e_eq`, `e_ge`, `e_gt`, `e_le`, `e_lt` |
| Bitwise | `e_and`, `e_or`, `e_not`, `e_shl`, `e_shr` |
| Random | **`e_rand`**, `e_randBounded` |
| Control | `e_select` (conditional without revealing condition) |

### 4. The Magic: `e_rand()` for Shuffling

From [Inco's random number docs](https://docs.inco.org/svm/guide/random):
> "Generates encrypted random numbers that cannot be predicted or known until decrypted by an authorized party."

This is **critical for poker**:
- Shuffle order is NEVER known to anyone (not even the program)
- Cards can be dealt as encrypted handles
- Only the player can decrypt their hole cards

---

## How Inco Could Enable TRUE Poker Privacy

### Phase 1: Encrypted Deck Shuffle
```rust
// Theoretical implementation with Inco
pub fn shuffle_deck(ctx: Context<Shuffle>) -> Result<()> {
    // Generate 52 encrypted random values
    for i in 0..52 {
        let encrypted_random = e_rand(cpi_ctx.clone(), 0)?;
        deck_state.shuffle_keys[i] = encrypted_random;
    }

    // Sort deck by encrypted keys (Fisher-Yates with e_lt comparisons)
    // The ORDER is never known until cards are revealed!
    Ok(())
}
```

### Phase 2: Encrypted Hole Cards
```rust
pub fn deal_hole_cards(ctx: Context<Deal>) -> Result<()> {
    // Player's cards are encrypted handles
    // NOBODY can see them - not even the validators
    player.hole_card_1 = deck_state.cards[deal_index];  // Euint128 handle
    player.hole_card_2 = deck_state.cards[deal_index + 1];

    // Set access control - only player can decrypt
    allowance(player.hole_card_1, player.wallet)?;
    allowance(player.hole_card_2, player.wallet)?;
    Ok(())
}
```

### Phase 3: Encrypted Hand Comparison (Showdown)
```rust
pub fn determine_winner(ctx: Context<Showdown>) -> Result<()> {
    // Compare hands WITHOUT revealing them!
    let player1_rank = evaluate_hand_encrypted(p1_cards)?;  // Euint128
    let player2_rank = evaluate_hand_encrypted(p2_cards)?;  // Euint128

    // Winner determination stays encrypted
    let p1_wins: Ebool = e_gt(player1_rank, player2_rank)?;

    // Conditional pot distribution without revealing who won (until claimed)
    let p1_prize = e_select(p1_wins, pot, 0)?;
    let p2_prize = e_select(e_not(p1_wins), pot, 0)?;
    Ok(())
}
```

---

## Critical Analysis: Pros & Cons

### Inco FHE Advantages

1. **TRUE Cryptographic Privacy**
   - Not "hidden by execution location" - mathematically impossible to see
   - Even if Inco's servers are compromised, encrypted data remains protected
   - No trust required in any operator

2. **On-Chain Verifiability**
   - All encrypted operations happen via CPI to Inco program
   - Audit trail exists for every operation
   - Decryption requires attestation from covalidator network

3. **Perfect for Poker's Trust Problem**
   - Dealer can't cheat (doesn't know deck order)
   - Players can't collude on card knowledge
   - House has no information advantage

4. **Encrypted Randomness (`e_rand`)**
   - Shuffle is provably fair AND private
   - No VRF seed visibility issue (it's encrypted from birth)

### Inco FHE Challenges

1. **Toolchain Blocker (Critical)**
   ```
   Error: Inco Lightning requires Rust edition2024
   Anchor's BPF toolchain only supports edition2021
   ```
   This is the SAME blocker we hit earlier. The dependency chain doesn't work with current Anchor.

2. **Beta Status**
   - [Launched January 9, 2026](https://www.inco.org/blog/inco-lightning-beta-launches-on-solana-devnet) on Solana devnet
   - "Features subject to change"
   - Limited production battle-testing

3. **Performance Overhead**
   - FHE operations are computationally expensive
   - Each encrypted operation = CPI call + off-chain computation
   - Latency for hand evaluation could be significant

4. **Complexity of Encrypted Hand Evaluation**
   - Evaluating poker hands (flushes, straights, full houses) in FHE is non-trivial
   - Would need to implement entire hand ranking system using `e_lt`, `e_eq`, `e_select`
   - Potentially hundreds of encrypted operations per showdown

5. **No Anchor-Specific Documentation**
   - Docs mention "Rust" but not explicit Anchor integration
   - May require manual account handling

---

## MagicBlock ER: Current Approach Reassessed

### What We Have Now
- **Privacy Model**: Execution happens on Ephemeral Rollup
- **Trust**: Need to trust MagicBlock's operators won't inspect ER state
- **The Fix We Implemented**: VRF seed stored on base layer, shuffle on ER
- **Guarantee**: Card order is OBSCURED (not on base Solana), but ER operators could theoretically see it

### MagicBlock's Actual Security
From [MagicBlock docs](https://docs.magicblock.gg/):
- ERs use SGX-based TEE (Trusted Execution Environment)
- State is encrypted in transit and at rest
- Similar trust model to Inco's compute server (both use TEE!)

**Key Insight**: Both MagicBlock AND Inco use TEEs for the actual computation. The difference is:
- **MagicBlock**: TEE runs the entire program execution
- **Inco**: TEE runs FHE operations, but data stays encrypted even within TEE

---

## Recommendation Matrix

| Use Case | Best Choice | Reason |
|----------|------------|--------|
| **Hackathon Demo (Now)** | MagicBlock ER | Works today, shows privacy concept |
| **Production Poker (Future)** | Inco FHE | True cryptographic guarantees |
| **If Toolchain Fixed** | Hybrid | VRF on base, FHE for cards via Inco |

---

## Realistic Path Forward

### Option A: Stay with MagicBlock (Recommended for Hackathon)
- Current implementation works
- Privacy is "good enough" for demo (TEE-based)
- Can complete and submit for hackathon
- Frame as "ER-based privacy with cryptographic upgrade path"

### Option B: Wait for Inco Toolchain Fix
- Monitor Anchor's Rust edition support
- When edition2024 works, integrate Inco for card encryption
- Keep MagicBlock for fast execution, add Inco for card-level FHE

### Option C: Hybrid Architecture (Post-Hackathon)
```
┌─────────────────────────────────────────────────────────┐
│                    Base Solana Layer                     │
│  - Table creation                                        │
│  - Player joins/leaves                                   │
│  - Pot management                                        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                MagicBlock Ephemeral Rollup               │
│  - Fast betting execution                                │
│  - State machine transitions                             │
│  - Low-latency gameplay                                  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Inco FHE Layer                        │
│  - Encrypted deck shuffle (e_rand)                       │
│  - Encrypted hole cards (Euint128 handles)               │
│  - Encrypted hand comparison at showdown                 │
│  - Access-controlled reveal                              │
└─────────────────────────────────────────────────────────┘
```

---

## Bottom Line

**Yes, Inco CAN provide true cryptographic privacy for poker.** The `e_rand` function for encrypted shuffling and `Euint128` for hole cards are exactly what we need for provably private poker.

**BUT** there are practical blockers:
1. **Toolchain incompatibility** (edition2024 vs Anchor's edition2021)
2. **Beta status** (not production-ready)
3. **Complexity** (hand evaluation in FHE is hard)

**For the hackathon**: MagicBlock ER is the pragmatic choice. The shuffle privacy fix we implemented addresses the most visible leak. TEE-based privacy is industry-standard (used by confidential computing everywhere).

**For the future**: Inco's FHE is the gold standard. When the toolchain catches up, integrating Inco for card-level encryption would give HiddenHand true mathematical privacy guarantees that no operator can break.

---

## Sources

- [Inco Documentation - Solana](https://docs.inco.org/svm/home)
- [Inco Rust SDK Overview](https://docs.inco.org/svm/rust-sdk/overview)
- [Inco Architecture - FHE](https://www.inco.org/blog/introducing-inco-the-modular-confidential-computing-network)
- [Inco Lightning Beta Launch](https://www.inco.org/blog/inco-lightning-beta-launches-on-solana-devnet)
- [Inco FHE Guide](https://www.inco.org/blog/fully-homomorphic-encryption-guide)
- [Solana VRF by ORAO](https://github.com/orao-network/solana-vrf)
