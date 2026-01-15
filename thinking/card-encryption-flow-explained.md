# Card Encryption Flow - Why Cards Are Truly Protected

> Documented: January 15, 2026
> Context: Explaining how Inco + MagicBlock achieves cryptographic card privacy

## The Core Question

Can we have cards encrypted on-chain where NO ONE can read them (not even tech-savvy users) until showdown?

**Answer: YES**

---

## How The Shuffle Auto-Feeds Into Inco

The encryption happens atomically inside the TEE:

```rust
// This all runs inside TEE (encrypted memory)
let deck = shuffle(vrf_seed);           // deck = [7, 23, 45, ...] in RAM
let encrypted = inco.encrypt(deck[0]);  // Value goes directly to Inco
// The "7" exists only in TEE RAM, never stored anywhere
```

The value flows: `shuffle result → Inco encryption → only handle stored`

**No human sees it.** The TEE is like a locked box that runs code. Operators can't inspect the RAM while it's running.

---

## Does Plaintext Persist On Any Blockchain?

**NO.** Here's the key insight about MagicBlock ER:

| Layer | What's Stored | Visible? |
|-------|--------------|----------|
| ER (during game) | Temporary RAM in TEE | No - encrypted memory |
| Base layer (after commit) | Only final state | Yes - but only encrypted handles |

```
DURING SHUFFLE (ER TEE RAM):
  deck = [7, 23, 45, ...]     ← EXISTS ONLY IN ENCRYPTED RAM

AFTER ENCRYPTION (ER TEE RAM):
  deck = [handle_1, handle_2, ...]  ← Plaintext gone

AFTER COMMIT (Base Layer Blockchain):
  player1.cards = [handle_1, handle_2]  ← Only this is on-chain
```

**A tech-savvy user CANNOT read the cards because:**
1. The plaintext is never written to any blockchain
2. The ER state is in TEE encrypted memory (not inspectable)
3. Only encrypted Inco handles are ever stored permanently

---

## What Inco Provides

Inco is the **decryption system**:

```
Without Inco:
  - We could encrypt cards... but how would players decrypt ONLY their own?

With Inco:
  - Player's wallet signature → Inco checks allowance → Returns plaintext
  - Only YOU can decrypt YOUR cards
  - Mathematical guarantee, not just "hidden"
```

### Key Inco Functions:
- `as_euint128(value)` → Encrypt a plaintext value, get handle
- `allow(handle, player_pubkey)` → Grant decryption access to a player
- Client-side `decrypt(handle, signature)` → Player retrieves their card

---

## The Real Trust Model

| Component | Trust Required | Risk Level |
|-----------|---------------|------------|
| VRF | None | Cryptographic proof of randomness |
| MagicBlock TEE | Yes - during shuffle (~1 sec) | Would need to hack Intel SGX |
| Inco TEE | Yes - holds encryption keys | Would need to hack their TEE |
| Base Layer | None | Only stores encrypted handles |

**"Tech-savvy user reading cards"** would require breaking Intel SGX security, not just reading blockchain data. This is the same security model used by:
- Signal (encrypted messaging)
- Password managers
- Financial institutions

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VRF (On-Chain)                               │
│                              │                                       │
│                         seed = 0xABC...                              │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    MAGICBLOCK ER (TEE)                        │   │
│  │                                                               │   │
│  │   deck = shuffle(seed)     // [7, 23, 45, ...] IN RAM ONLY   │   │
│  │            │                                                  │   │
│  │            ▼                                                  │   │
│  │   ┌─────────────────────────────────────────────────────┐    │   │
│  │   │              INCO (TEE)                              │    │   │
│  │   │                                                      │    │   │
│  │   │   handle_1 = encrypt(7)   // 7 exists briefly here  │    │   │
│  │   │   handle_2 = encrypt(23)  // then gone              │    │   │
│  │   │                                                      │    │   │
│  │   │   Returns: [handle_1, handle_2, ...]                │    │   │
│  │   └─────────────────────────────────────────────────────┘    │   │
│  │            │                                                  │   │
│  │            ▼                                                  │   │
│  │   player1.cards = [handle_1, handle_2]  // Only handles      │   │
│  │   player2.cards = [handle_3, handle_4]  // stored            │   │
│  │                                                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                         COMMIT                                       │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    BASE LAYER (Public)                        │   │
│  │                                                               │   │
│  │   player1.cards = [0x1A2B..., 0x3C4D...]  // Encrypted only  │   │
│  │   player2.cards = [0x5E6F..., 0x7G8H...]  // Can't read!     │   │
│  │                                                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    CLIENT (Player's Browser)                  │   │
│  │                                                               │   │
│  │   signature = wallet.sign("decrypt request")                 │   │
│  │   card = inco.decrypt(handle_1, signature)                   │   │
│  │                                                               │   │
│  │   // Only Player 1 sees: card = 7 (Seven of Hearts)          │   │
│  │                                                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Where Plaintext Exists (Briefly)

1. **ER TEE RAM** - During shuffle computation (~milliseconds)
2. **Inco TEE RAM** - During encryption call (~milliseconds)
3. **Client browser** - After player decrypts their own cards

**Where plaintext NEVER exists:**
- Base layer blockchain (only encrypted handles)
- Transaction logs (only handles)
- Any persistent storage accessible to observers

---

## Summary

- ✅ Plaintext **never touches** any blockchain
- ✅ Values flow directly: `shuffle → Inco encrypt → handle stored`
- ✅ Only encrypted handles are permanent
- ✅ Players decrypt client-side via Inco allowance
- ✅ Breaking this requires compromising Intel SGX, not "reading blockchain"

**The cards are truly cryptographically protected on-chain.**
