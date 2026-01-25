# HiddenHand

**The only poker game where the house can't see your cards.**

HiddenHand is a fully on-chain Texas Hold'em poker game with cryptographic privacy guarantees. Built on Solana with MagicBlock VRF for provably fair shuffling and Inco Lightning FHE for encrypted hole cards.

> *"Don't trust the dealer. Trust the math."*

---

## The Problem

Every year, **$60 billion** flows through online poker. And every hand you play, you're betting that the platform won't cheat, that their employees won't peek, that their servers won't get hacked.

In 2007, insiders at Ultimate Bet could see every player's hole cards. They stole **millions** before anyone noticed.

**The dirty secret of online poker? The game is only as honest as the people running it.**

## The Solution

HiddenHand is the first poker game where **no one can see your cards—not even us.**

| Traditional Online Poker | HiddenHand |
|-------------------------|------------|
| Server sees all cards | Cards encrypted on-chain |
| Database can be hacked | State lives on Solana |
| Superuser exploits possible | Cryptographic guarantees |
| "Trust us" | Verify the math |

---

## Security Model

HiddenHand combines three cryptographic layers to eliminate trust requirements:

### Layer 1: Provably Fair Shuffling (MagicBlock VRF)

**What it does:** Generates verifiable random numbers that no one can predict or manipulate.

**How it works:**
1. Game requests randomness from MagicBlock VRF oracle
2. Oracle generates random seed using Verifiable Random Function
3. VRF proof is verified on-chain before use
4. Deck is shuffled using the verified seed

**Security guarantee:** The shuffle is provably fair—anyone can verify the randomness was not manipulated. The VRF seed exists only in memory during the callback transaction and is never stored on-chain.

### Layer 2: Card Encryption (Inco Lightning FHE)

**What it does:** Encrypts all cards—both hole cards AND community cards—so no one can see them prematurely.

**How it works:**
1. After shuffle, ALL 52 cards are encrypted via Inco's Fully Homomorphic Encryption
2. Cards are stored on-chain as encrypted `u128` handles
3. **Hole cards**: Decryption allowances granted only to the card owner
4. **Community cards**: Remain encrypted until flop/turn/river, then revealed with Ed25519 verification
5. Players decrypt their hole cards client-side using wallet signature + Inco SDK

**Security guarantee:** No one can see the flop, turn, or river in advance. Hole cards cannot be decrypted without the player's wallet signature. The program, other players, and even the table authority cannot see encrypted cards.

### Layer 3: Verified Reveals (Ed25519 Signatures)

**What it does:** Prevents players from lying about their cards at showdown.

**How it works:**
1. To reveal a card, player must provide the plaintext value
2. Player must also provide an Ed25519 signature from Inco's covalidator
3. The signature proves the plaintext matches the encrypted handle
4. Invalid signatures are rejected—fake cards cannot be claimed

**Security guarantee:** Cryptographic proof that revealed cards match encrypted values. Players cannot claim to have different cards than they were dealt.

### Attack Prevention Summary

| Attack Vector | Prevention |
|--------------|------------|
| Rigged shuffle | VRF provides verifiable randomness with on-chain proof |
| Peeking at hole cards | FHE encryption—only card owner can decrypt |
| Peeking at community cards | FHE encryption—revealed only at flop/turn/river with Ed25519 proof |
| Card forgery at showdown | Ed25519 signatures verify card authenticity |
| Seed prediction | VRF seed never stored, only in-memory during callback |
| Replay attacks | Unique encryption handles per card per hand |
| Stalled games | Timeout mechanisms force action or auto-fold |
| Authority collusion | Authority cannot decrypt player cards (no allowance) |

### Trust Assumptions

HiddenHand minimizes trust, but some assumptions remain:

1. **Inco Lightning TEE**: Card encryption relies on Inco's Trusted Execution Environment
2. **MagicBlock VRF Oracle**: Randomness depends on MagicBlock's oracle availability
3. **Solana Consensus**: Game state security depends on Solana's validator set

These are infrastructure-level dependencies, not application-level trust. No single party can cheat the game.

---

## How It Works

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           GAME FLOW                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. START HAND          2. VRF SHUFFLE           3. ENCRYPT CARDS        │
│  ┌─────────────┐       ┌─────────────┐          ┌─────────────┐         │
│  │ Initialize  │──────▶│  Request    │─────────▶│ Inco FHE    │         │
│  │ deck state  │       │  VRF seed   │          │ encryption  │         │
│  └─────────────┘       └─────────────┘          └─────────────┘         │
│                              │                         │                 │
│                              ▼                         ▼                 │
│                     ┌─────────────┐          ┌─────────────┐            │
│                     │ Callback:   │          │ Grant       │            │
│                     │ shuffle +   │          │ allowances  │            │
│                     │ deal cards  │          │ to players  │            │
│                     └─────────────┘          └─────────────┘            │
│                                                      │                   │
│  6. SHOWDOWN            5. BETTING              4. DECRYPT               │
│  ┌─────────────┐       ┌─────────────┐          ┌─────────────┐         │
│  │ Ed25519     │◀──────│ Fold/Check/ │◀─────────│ Player      │         │
│  │ verified    │       │ Call/Raise/ │          │ decrypts    │         │
│  │ reveals     │       │ All-In      │          │ own cards   │         │
│  └─────────────┘       └─────────────┘          └─────────────┘         │
│        │                                                                 │
│        ▼                                                                 │
│  ┌─────────────┐                                                        │
│  │ Evaluate    │                                                        │
│  │ hands &     │                                                        │
│  │ distribute  │                                                        │
│  │ pot         │                                                        │
│  └─────────────┘                                                        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Privacy Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  MagicBlock VRF │────▶│  Atomic Shuffle │────▶│  Inco FHE       │
│  (Randomness)   │     │  + Encrypt      │     │  (Encryption)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Player Wallet  │◀────│  Inco SDK       │◀────│  Covalidator    │
│  (View Cards)   │     │  (Decrypt)      │     │  (TEE)          │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## Features

- **Provably Fair Shuffling** — MagicBlock VRF provides verifiable randomness
- **Encrypted Hole Cards** — Inco Lightning FHE (cards stored as encrypted u128 handles)
- **Ed25519 Verified Reveals** — Covalidator signatures prove card authenticity
- **Full Texas Hold'em** — PreFlop, Flop, Turn, River, Showdown
- **On-Chain Hand History** — Every action emitted as Anchor events for audit trail
- **Timeout Protection** — Players can't stall indefinitely (30s action timeout)
- **AFK Recovery** — Non-authority players can continue after 60s authority timeout
- **Abandoned Table Recovery** — Anyone can close inactive tables after 5 minutes
- **Client-Side Decryption** — Only you can see your cards via wallet signing
- **42 Unit Tests** — Comprehensive coverage for hand evaluation and game logic

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Smart Contract | Anchor 0.32.1 / Rust | Game logic & state management |
| Blockchain | Solana Devnet | Settlement & data availability |
| Randomness | MagicBlock VRF | Provably fair card shuffling |
| Encryption | Inco Lightning FHE | Hole card privacy |
| Signatures | Ed25519 | Card reveal verification |
| Frontend | Next.js 15 / TypeScript | Player interface |
| Wallet | Solana Wallet Adapter | Authentication & signing |

### Program IDs

| Program | Address |
|---------|---------|
| HiddenHand | `HS3GdhRBU3jMT4G6ogKVktKaibqsMhPRhDhNsmgzeB8Q` |
| Inco Lightning | `5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj` |
| MagicBlock VRF | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` |

---

## Getting Started

### Prerequisites

- Rust & Cargo
- Solana CLI
- Anchor CLI (0.32.1)
- Node.js 18+
- Solana wallet with devnet SOL

### Installation

```bash
# Clone the repository
git clone https://github.com/sbarrientos2/HiddenHand.git
cd HiddenHand

# Install dependencies
npm install

# Build the program
anchor build

# Run tests
anchor test
```

### Running the Frontend

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and connect your wallet.

### Playing the Game

1. **Create or Join Table** — Enter a table ID and buy-in amount
2. **Wait for Players** — Minimum 2 players required
3. **Start Hand** — Table authority initiates the hand
4. **VRF Shuffle** — Provably fair shuffle with on-chain verification
5. **Decrypt Cards** — View your encrypted hole cards
6. **Play Poker** — Fold, Check, Call, Raise, or All-In
7. **Showdown** — Ed25519 verified reveals determine the winner

---

## Project Structure

```
HiddenHand/
├── programs/hiddenhand/src/
│   ├── lib.rs                    # Entry point (19 instructions)
│   ├── instructions/
│   │   ├── create_table.rs       # Table creation
│   │   ├── join_table.rs         # Player buy-in
│   │   ├── start_hand.rs         # Hand initialization
│   │   ├── request_shuffle.rs    # VRF randomness request
│   │   ├── callback_shuffle.rs   # VRF callback + shuffle
│   │   ├── deal_cards_encrypted.rs
│   │   ├── player_action.rs      # Betting logic
│   │   ├── showdown.rs           # Hand evaluation
│   │   ├── reveal_cards.rs       # Ed25519 verification
│   │   ├── timeout_player.rs     # Action timeout
│   │   ├── timeout_reveal.rs     # Showdown timeout
│   │   └── close_inactive_table.rs
│   ├── state/
│   │   ├── table.rs              # Table configuration
│   │   ├── hand.rs               # Hand state & phases
│   │   ├── player.rs             # Player seats & chips
│   │   ├── deck.rs               # Card utilities
│   │   └── hand_eval.rs          # Poker hand ranking
│   ├── inco_cpi.rs               # Inco FHE integration
│   └── error.rs                  # 30+ custom errors
├── app/                          # Next.js frontend
│   ├── components/               # UI components
│   ├── hooks/                    # React hooks
│   └── lib/                      # Utilities & IDL
└── tests/                        # Integration tests
```

---

## Game Mechanics

### Card Encoding
- Cards encoded as 0-51 (u8)
- Suit: `card / 13` → 0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades
- Rank: `card % 13` → 0=2, 1=3, ..., 12=Ace

### Hand Rankings (On-Chain Evaluation)
1. Royal Flush
2. Straight Flush
3. Four of a Kind
4. Full House
5. Flush
6. Straight
7. Three of a Kind
8. Two Pair
9. One Pair
10. High Card

### Betting Actions
| Action | Description |
|--------|-------------|
| Fold | Surrender your hand |
| Check | Pass (when no bet to call) |
| Call | Match the current bet |
| Raise | Increase the bet |
| All-In | Bet all remaining chips |

---

## Hackathon

**Solana Privacy Hack** — January 12-30, 2025

### Target Bounties
- Inco Gaming Track
- Open Track

### Submission Checklist
- [x] Open-source code
- [x] Deployed to Solana devnet
- [x] Comprehensive documentation
- [x] 42 unit tests passing
- [x] Ed25519 signature verification
- [x] MagicBlock VRF integration
- [x] Inco FHE encryption
- [ ] 3-minute demo video

---

## Future Roadmap

- [ ] Multi-table tournaments
- [ ] Spectator mode
- [ ] In-game chat
- [ ] Mainnet deployment
- [ ] Tournament mode with blind escalation
- [ ] Mobile app

---

## License

MIT

---

<p align="center">
  <strong>HiddenHand</strong><br>
  <em>Poker you can verify.</em>
</p>
