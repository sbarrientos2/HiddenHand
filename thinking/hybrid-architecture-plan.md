# ULTRATHINK: Hybrid Inco + MagicBlock Architecture

> Analysis Date: January 2026
> Context: Designing Option B implementation for HiddenHand poker with true cryptographic privacy

## The Fundamental Challenge

Let me first identify the core cryptographic challenge with FHE and card games:

**The Shuffle Problem:**
```
Traditional shuffle: Generate permutation → Deal sequentially
FHE shuffle:        ???
```

With FHE, you can't efficiently:
- Access `array[encrypted_index]` (leaks access patterns)
- Check for duplicates across encrypted values (expensive)
- Generate a permutation purely in encrypted space

**This is why pure FHE poker is hard.**

---

## The Insight: Use Each Tool for What It's Best At

| Tool | Strength | Use For |
|------|----------|---------|
| **VRF** | Verifiable randomness | Proving shuffle is fair |
| **MagicBlock ER** | Hidden execution | Performing the shuffle |
| **Inco FHE** | Cryptographic encryption | Storing card values |

**Key Realization:** The shuffle ORDER doesn't need FHE encryption - it just needs to be:
1. Unpredictable (VRF provides this)
2. Hidden during execution (ER provides this)
3. Results stored encrypted (Inco provides this)

---

## The Privacy Timeline

```
                TIME →
    ┌─────────────────────────────────────────────────────────────────┐
    │                                                                 │
    │  VRF SEED    SHUFFLE      DEAL        BETTING      SHOWDOWN     │
    │  (public)    (hidden)     (encrypt)   (private)    (reveal)     │
    │     │           │            │            │            │        │
    │     ▼           ▼            ▼            ▼            ▼        │
    │  Anyone      Only ER     Inco FHE     Only owner   Everyone     │
    │  can see     sees it     encrypts     can decrypt  sees hands   │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
```

**The "Brief Plaintext Window":**
There's a moment on the ER when the shuffled deck exists in plaintext before Inco encryption. This is our remaining trust assumption - we trust MagicBlock's TEE during this window.

---

## Account Structure Changes

### Current Structure:
```rust
pub struct PlayerSeat {
    pub hole_card_1: u128,  // Plain card value
    pub hole_card_2: u128,  // Plain card value
    // ...
}

pub struct DeckState {
    pub cards: [u128; 52],  // Plain shuffled deck
    // ...
}
```

### New Hybrid Structure:
```rust
pub struct PlayerSeat {
    // Inco encrypted handles - only owner can decrypt
    pub hole_card_1_handle: Euint128,
    pub hole_card_2_handle: Euint128,
    pub cards_encrypted: bool,  // Flag: are cards Inco-encrypted?
    // ...
}

pub struct DeckState {
    pub cards: [u128; 52],           // Shuffle result (on ER only)
    pub community_handles: [Euint128; 5],  // Encrypted community cards
    pub vrf_seed: [u8; 32],
    // ...
}

// NEW: Track Inco handles and allowances
pub struct CardEncryption {
    pub hand: Pubkey,
    pub player_handles: [(Pubkey, Euint128, Euint128); MAX_PLAYERS],
    pub community_handles: [Euint128; 5],
    pub community_revealed: u8,  // Bitmask of revealed community cards
}
```

---

## Complete Instruction Flow

### Phase 1: Setup (Base Layer)
```
┌─────────────────────────────────────────────────────────────┐
│ 1. create_table(config)                                     │
│    → Creates Table account                                  │
│                                                             │
│ 2. join_table(seat_index, buy_in)                          │
│    → Creates PlayerSeat, deposits SOL                       │
│                                                             │
│ 3. start_hand()                                            │
│    → Creates HandState, DeckState, CardEncryption          │
│    → Requests VRF randomness                                │
│                                                             │
│ 4. callback_shuffle(vrf_seed)                              │
│    → Stores VRF seed (shuffle NOT done yet)                │
│    → Phase: Dealing                                         │
└─────────────────────────────────────────────────────────────┘
```

### Phase 2: Delegation (Base → ER)
```
┌─────────────────────────────────────────────────────────────┐
│ 5. delegate_accounts()                                      │
│    → HandState, DeckState, PlayerSeats → MagicBlock ER     │
│    → CardEncryption stays on base (for Inco CPIs)          │
└─────────────────────────────────────────────────────────────┘
```

### Phase 3: Private Dealing (On ER)
```
┌─────────────────────────────────────────────────────────────┐
│ 6. shuffle_and_deal()  [ON EPHEMERAL ROLLUP]               │
│                                                             │
│    a) Fisher-Yates shuffle using VRF seed                   │
│       → Deck order known only to ER                         │
│                                                             │
│    b) For each player:                                      │
│       → card1 = deck[deal_index++]                          │
│       → card2 = deck[deal_index++]                          │
│       → CPI to Inco: handle1 = e_new(card1)                │
│       → CPI to Inco: handle2 = e_new(card2)                │
│       → CPI to Inco: allowance(handle1, player_pubkey)     │
│       → CPI to Inco: allowance(handle2, player_pubkey)     │
│       → Store handles in PlayerSeat                         │
│                                                             │
│    c) Encrypt community cards (positions 0-4):              │
│       → For i in 0..5: community_handles[i] = e_new(deck[i])│
│       → These remain encrypted until reveal phases          │
│                                                             │
│    d) Zero out plain deck values (security)                 │
│       → deck.cards = [0; 52]                                │
│                                                             │
│    → Phase: PreFlop                                         │
└─────────────────────────────────────────────────────────────┘
```

### Phase 4: Gameplay (On ER)
```
┌─────────────────────────────────────────────────────────────┐
│ 7. player_action(action, amount)                           │
│    → Fold / Check / Call / Raise / AllIn                   │
│    → Standard betting logic                                 │
│    → When betting round complete, advance phase             │
│                                                             │
│ 8. reveal_community(phase)  [Called automatically]          │
│    → Flop: Grant allowance for community_handles[0,1,2]    │
│           to ALL players (public reveal)                    │
│    → Turn: Grant allowance for community_handles[3]        │
│    → River: Grant allowance for community_handles[4]       │
│                                                             │
│    Note: "Reveal" = granting allowance, not decrypting     │
│    Clients call attested_reveal to see the values          │
└─────────────────────────────────────────────────────────────┘
```

### Phase 5: Showdown
```
┌─────────────────────────────────────────────────────────────┐
│ 9. submit_hand_reveal(player, revealed_cards)              │
│    → Player provides attested decrypt proof                │
│    → Program verifies proof matches stored handles         │
│    → Store revealed hand for evaluation                    │
│                                                             │
│ 10. evaluate_showdown()                                    │
│    → All active players have revealed hands                │
│    → Hand evaluation in PLAINTEXT (existing code!)         │
│    → Winner(s) determined                                  │
│    → Pot distributed                                       │
│    → Phase: Settled                                        │
└─────────────────────────────────────────────────────────────┘
```

### Phase 6: Commit (ER → Base)
```
┌─────────────────────────────────────────────────────────────┐
│ 11. undelegate_accounts()                                  │
│    → Final chip counts committed to base layer             │
│    → Ready for next hand                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Client-Side Flow

```typescript
// Player views their hole cards
async function viewMyCards(wallet, seatAccount) {
  const handles = [
    seatAccount.holeCard1Handle,
    seatAccount.holeCard2Handle
  ];

  // Inco attested decrypt - requires wallet signature
  const result = await decrypt(handles, {
    address: wallet.publicKey,
    signMessage: wallet.signMessage
  });

  return {
    card1: decodeCard(result.plaintexts[0]),
    card2: decodeCard(result.plaintexts[1])
  };
}

// View community cards (after reveal phase)
async function viewCommunityCards(wallet, cardEncryptionAccount, phase) {
  const numCards = phase === 'flop' ? 3 : phase === 'turn' ? 4 : 5;
  const handles = cardEncryptionAccount.communityHandles.slice(0, numCards);

  // Public reveal - anyone can decrypt after allowance granted
  const result = await attestedReveal(handles);

  return result.plaintexts.map(decodeCard);
}

// At showdown - reveal your hand
async function revealHandForShowdown(wallet, program, seatAccount) {
  // Get attested decrypt proof
  const proof = await getAttestedDecryptProof(
    [seatAccount.holeCard1Handle, seatAccount.holeCard2Handle],
    { address: wallet.publicKey, signMessage: wallet.signMessage }
  );

  // Submit proof on-chain
  await program.methods
    .submitHandReveal(proof.plaintexts, proof.attestation)
    .accounts({ player: wallet.publicKey, seat: seatAccount })
    .rpc();
}
```

---

## Trust Model & Privacy Guarantees

### What's Cryptographically Guaranteed (Math):
| Property | Guarantee | How |
|----------|-----------|-----|
| Only you see your cards | Mathematical | Inco allowance + FHE |
| Community cards hidden until phase | Mathematical | Encrypted handles |
| Cards can't be forged | Mathematical | Attested proofs |
| Showdown hands verified | Mathematical | Proof verification |

### What's TEE-Guaranteed (Trust MagicBlock):
| Property | Guarantee | How |
|----------|-----------|-----|
| Shuffle is fair | VRF + TEE | VRF seed + ER execution |
| Shuffle order hidden | TEE | ER operators could theoretically see |

### The Residual Trust:
```
During shuffle_and_deal():
  - ER sees: VRF seed → plain deck order → plain card values
  - Then immediately: card values → Inco encryption
  - After: Only encrypted handles exist

Trust window: ~1-2 seconds during deal instruction
After that: Cryptographic privacy (zero trust required)
```

---

## Why This Is Still a Massive Improvement

| Threat | Current (ER Only) | Hybrid (Inco + ER) |
|--------|-------------------|---------------------|
| Random Solana user | Can't see | Can't see |
| Knows ER endpoint | CAN query & see | Can query but ENCRYPTED |
| ER operator (persistent) | CAN see state | Can't see (only handles) |
| ER operator (during deal) | CAN see | CAN see briefly |
| Sophisticated attacker | CAN reconstruct | CANNOT decrypt |

**The key improvement:** After dealing completes, card privacy is **mathematically guaranteed**, not just hidden by obscurity.

---

## Implementation Modules

```
programs/hiddenhand/src/
├── lib.rs                      # Add new Inco instructions
├── state/
│   ├── deck.rs                 # Add Euint128 handles
│   ├── player.rs               # Add encrypted card handles
│   └── card_encryption.rs      # NEW: Inco handle tracking
├── instructions/
│   ├── shuffle_and_deal.rs     # MODIFY: Add Inco encryption
│   ├── reveal_community.rs     # NEW: Grant community allowances
│   ├── submit_hand_reveal.rs   # NEW: Verify showdown proofs
│   └── ...
└── inco/
    ├── mod.rs                  # Inco CPI helpers
    ├── types.rs                # Euint128, Ebool wrappers
    └── operations.rs           # e_new, allowance, etc.
```

---

## 15-Day Implementation Roadmap

| Days | Focus | Deliverable |
|------|-------|-------------|
| 1-2 | Inco integration module | CPI helpers, type wrappers |
| 3-4 | Modify DeckState & PlayerSeat | Add Euint128 handle fields |
| 5-6 | shuffle_and_deal with Inco | Encrypt cards during deal |
| 7-8 | Client decryption | JS SDK integration |
| 9-10 | Community card reveals | Phase-based allowance granting |
| 11-12 | Showdown with proofs | submit_hand_reveal instruction |
| 13-14 | Testing & debugging | End-to-end flow |
| 15 | Demo prep & polish | Video, documentation |

---

## Critical Question: Can ER CPI to Inco?

This is the architectural linchpin. If MagicBlock ER can do CPIs to the Inco Lightning program on base layer, the design works cleanly.

If NOT, we need an alternative:
- **Option A:** Encrypt on commit back to base layer (brief exposure window)
- **Option B:** Client-side encryption with authority coordination
- **Option C:** Two-step: deal on ER, encrypt in separate base layer tx

This needs to be verified before implementation begins.

---

## Summary

**This architecture gives you:**
1. Verifiable fair shuffle (VRF)
2. Fast gameplay (MagicBlock ER)
3. Cryptographic hole card privacy (Inco FHE)
4. Public showdown (Option B - real poker rules)
5. Minimal trust assumptions (only during deal instruction)

---

## TEST RESULTS (January 15, 2026)

### Test 1: Inco CPI from Base Layer - SUCCESS

Successfully tested Inco's `e_rand()` function via CPI from our test program on devnet.

**Evidence:**
- Test program: `J6gLdXApGmMLSbW33zihUa7RCfVtpAbhnqrZiFAAZLKg`
- Transaction: `3ZWDZcwADoFRKuQXkmrfPs66chqWiLeJoif691AfAZws6FE9T11Ej2VY4ooEyQ44Py2zWorYCpJJ8mmjsAc81dsR`
- Result: Successfully received encrypted handle from Inco

**Conclusion:** Inco CPI **WORKS** on the base Solana layer. The `e_rand()` function returns an `Euint128` handle.

### Test 2: Delegation to MagicBlock ER - BLOCKED

Attempted to delegate a test account to MagicBlock ER to test if Inco CPI works from within the ER.

**Blockers:**
1. **Version Conflict:** `inco-lightning` requires Anchor 0.31.1, but `ephemeral-rollups-sdk` requires Anchor 0.32.1
2. **Manual CPI Complexity:** Attempted to manually construct delegation CPI without the SDK
3. **Validation Error:** Delegation program returns "Invalid account owner for delegated account" even though the owner is correct

**Detailed Error:**
```
Program DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh invoke [2]
Program log: Invalid account owner for delegated account:
Program log: 6xA3xoWkmZG38aWxYohniRaKvLagZUKffGBSmcNFRN5e
```

**What We Tried:**
- Adding all required accounts (delegate_buffer, delegation_record, delegation_metadata, owner_program)
- Including PDA seeds in instruction data
- Using `invoke_signed` with correct signer seeds
- Creating fresh accounts to rule out state corruption

### Architectural Implications

Given the delegation complexity, here are the viable options:

**Option A: Base Layer Encryption (Recommended for Hackathon)**
- Encrypt cards on base layer before delegating to ER
- Game runs on ER with already-encrypted card handles
- Reveals happen by granting Inco allowances
- Showdown decrypts cards from stored handles

**Option B: Commit-Time Encryption**
- Deal cards as plain values on ER (TEE-protected)
- Encrypt cards when committing back to base layer
- Slightly longer trust window but simpler implementation

**Option C: Client-Side Encryption**
- Client generates encryption locally
- Less secure but avoids CPI complexity

### Recommendation

For the hackathon deadline, **Option A** is recommended:

1. **Initialize hand on base layer** - Create hand state, request VRF
2. **VRF callback stores seed** - Don't shuffle yet
3. **On ER:** Perform shuffle using seed, deal cards as plain values
4. **Before showing to players:** CPI to Inco to encrypt each card
5. **Grant allowances** to card owners
6. **At showdown:** Players reveal via Inco attested decrypt

This approach:
- Avoids the delegation complexity
- Still achieves cryptographic privacy
- Uses ER for fast gameplay
- Only requires Inco CPI from ER (which needs verification)

### Next Steps

1. **Ask MagicBlock directly:** Can ER programs make CPI calls to programs on the base layer?
2. If yes: Proceed with hybrid architecture
3. If no: Use Option B (commit-time encryption) or Option C (client-side)

---

## MAGICBLOCK RESPONSE (January 15, 2026)

**CONFIRMED: YES, ER can call base layer programs via Magic Actions!**

### What Are Magic Actions?

Magic Actions enable attaching CPI calls that run automatically on the Solana base layer immediately after an ER commit. This is exactly what we need!

**Documentation:** https://docs.magicblock.gg/pages/ephemeral-rollups-ers/magic-actions/overview
**Code Example:** https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/magic-actions

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Delegate accounts to ER                                       │
│ 2. Execute fast transactions on ER (poker gameplay)              │
│ 3. Commit with attached "handlers" (Magic Actions)               │
│ 4. Handlers automatically CPI to base layer programs (Inco!)     │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Pattern

```rust
// When dealing cards on ER, use commit with handler:
let action = CallHandler {
    destination_program: INCO_PROGRAM_ID,  // Inco Lightning
    accounts: vec![...],
    args: ActionArgs::new(inco_instruction_data),
    compute_units: 200_000,
};

MagicInstructionBuilder {
    magic_action: MagicAction::Commit(CommitType::WithHandler {
        commited_accounts: vec![deck_state, player_seats],
        call_handlers: vec![action],  // This CPIs to Inco!
    }),
}.build_and_invoke()?;
```

### Remaining Challenge: Version Conflict

- `inco-lightning` requires Anchor 0.31.1
- `ephemeral-rollups-sdk` requires Anchor 0.32.1

**Solutions:**
1. Wait for `inco-lightning` to update to 0.32.1
2. Create a separate "Inco wrapper" program with 0.31.1
3. Ask Inco team about version compatibility

### Architecture Decision: CONFIRMED VIABLE

The hybrid Inco + MagicBlock architecture **IS VIABLE**:
- Fast gameplay on ER ✓
- Cryptographic card encryption via Inco ✓
- Magic Actions bridge the two ✓

Only the version conflict needs resolution before implementation.

---

## PHASE 2 IMPLEMENTATION (January 15, 2026)

### Solution: Manual Inco CPI (No SDK)

To avoid the version conflict between `inco-lightning` (Anchor 0.31.1) and `ephemeral-rollups-sdk` (Anchor 0.32.1), we implemented **manual Inco CPI construction**.

**Key insight:** The Inco SDK is just a convenience wrapper around CPI calls. We can construct the same instructions manually.

### Files Created

**1. `programs/hiddenhand/src/inco_cpi.rs`** - Manual Inco CPI Module
```rust
// Pre-computed discriminators (SHA256 of "global:function_name")
mod discriminators {
    pub const AS_EUINT128: [u8; 8] = [...];  // Encrypt plaintext
    pub const ALLOW: [u8; 8] = [...];        // Grant allowance
}

// Main functions:
pub fn encrypt_card(signer, card_value) -> Result<EncryptedCard>
pub fn grant_allowance_with_pubkey(signer, allowance_account, player, system, handle)
pub fn derive_allowance_account(handle, player) -> (Pubkey, u8)
```

**2. `programs/hiddenhand/src/instructions/encrypt_hole_cards.rs`** - Encryption Instruction
- Called once per player with their seat_index
- Reads plaintext cards (0-51) from PlayerSeat
- Encrypts each card via Inco CPI
- Grants allowance to the player
- Updates PlayerSeat with encrypted handles

### Usage Flow

```
1. deal_cards_vrf (on ER)
   - Shuffles deck with VRF seed
   - Stores plaintext cards in PlayerSeat

2. encrypt_hole_cards (via Magic Actions on commit)
   - For each player seat:
     - encrypt_hole_cards(seat_index=0)
     - encrypt_hole_cards(seat_index=1)
     - ...
   - Cards are now encrypted handles
   - Allowances granted to players

3. Player views cards (client-side)
   - Inco.decrypt(handle, wallet_signature)
   - Only the player with allowance can decrypt
```

### Build Status: SUCCESS

```
$ anchor build -p hiddenhand
   Compiling hiddenhand v0.1.0
    Finished `release` profile [optimized] target(s) in 12.22s
```

All 14 existing tests continue to pass.

---

## Files Created for Testing

- `programs/inco-er-test/` - Test program for Inco CPI
- `scripts/test-inco-cpi.mjs` - Base layer test (successful)
- `scripts/test-inco-from-er.mjs` - ER test (blocked by delegation)

---

## Remaining Work

1. **Magic Actions Integration:** Wire up `encrypt_hole_cards` to be called via Magic Actions after ER commit
2. **Community Card Reveal:** Implement `reveal_community_cards` to grant allowances for flop/turn/river
3. **Showdown Verification:** Verify revealed cards match stored handles
4. **Client SDK:** Add Inco decrypt calls to frontend
5. **Testing:** End-to-end test on devnet
