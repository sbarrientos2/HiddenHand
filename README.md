# HiddenHand

**The only poker game where the house can't see your cards.**

HiddenHand is a fully on-chain Texas Hold'em poker game with cryptographic privacy guarantees. Built on Solana with MagicBlock VRF for provably fair shuffling and Inco Lightning FHE for encrypted hole cards.

> *"Don't trust the dealer. Trust the math."*

## The Problem

Every year, **$60 billion** flows through online poker. And every hand you play, you're betting that the platform won't cheat, that their employees won't peek, that their servers won't get hacked.

In 2007, insiders at Ultimate Bet could see every player's hole cards. They stole **millions** before anyone noticed.

**The dirty secret of online poker? The game is only as honest as the people running it.**

## The Solution

HiddenHand is the first poker game where **no one can see your cards. Not even us.**

- **No server that sees all cards** - Cards are encrypted on-chain
- **No database to hack** - State lives on Solana
- **No superuser exploits** - Cryptographic guarantees
- **No "trust us"** - Just math

## Features

- **Provably Fair Shuffling** - MagicBlock VRF provides verifiable randomness
- **Encrypted Hole Cards** - Inco Lightning FHE encryption (cards encrypted as u128 handles)
- **Ed25519 Verified Reveals** - Covalidator signatures prove card authenticity at showdown
- **Full Texas Hold'em** - PreFlop, Flop, Turn, River, Showdown
- **Multi-round Gameplay** - Play consecutive hands with persistent chip stacks
- **Timeout Protection** - Players can't stall the game indefinitely
- **Abandoned Table Recovery** - Anyone can close inactive tables and return funds
- **Client-side Decryption** - Only you can see your cards via wallet signing
- **42 Unit Tests** - Comprehensive test coverage for hand evaluation and game logic

## How It Works

```
1. Start Hand     → Initialize deck and hand state
2. VRF Shuffle    → Request verifiable random seed from MagicBlock oracle
3. Atomic Deal    → VRF callback shuffles deck + encrypts cards in one transaction
4. Grant Access   → Authority grants decryption allowances to players
5. Decrypt Cards  → Players decrypt their own cards client-side via Inco SDK
6. Play Poker     → Standard betting rounds (Fold/Check/Call/Raise/All-In)
7. Showdown       → Ed25519-verified card reveals, evaluate hands, distribute pot
```

### Security at Showdown

When revealing cards, players must provide Ed25519 signatures from Inco covalidators. This cryptographically proves that the revealed card values match the encrypted handles stored on-chain. Without valid signatures, players cannot claim arbitrary card values.

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

**Key Security Property:** The VRF seed is NEVER stored on-chain. It only exists in memory during the callback transaction, then is discarded. This eliminates the risk of seed exposure.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Smart Contract | Anchor 0.32.1 / Rust |
| Blockchain | Solana Devnet |
| Randomness | MagicBlock VRF (`ephemeral-vrf-sdk`) |
| Encryption | Inco Lightning FHE |
| Frontend | Next.js 15 / TypeScript |
| Wallet | Solana Wallet Adapter |

## Program IDs

| Program | ID |
|---------|-----|
| HiddenHand | `HS3GdhRBU3jMT4G6ogKVktKaibqsMhPRhDhNsmgzeB8Q` |
| Inco Lightning | `5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj` |
| MagicBlock VRF | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` |

## Getting Started

### Prerequisites

- Rust & Cargo
- Solana CLI
- Anchor CLI (0.32.1)
- Node.js 18+
- A Solana wallet with devnet SOL

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

1. **Create or Join Table** - Enter a table ID and buy-in amount
2. **Wait for Players** - Need 2+ players to start
3. **Start Hand** - Authority clicks "Start Hand"
4. **Shuffle (VRF)** - Request provably fair shuffle
5. **Grant Allowances** - Enable players to decrypt their cards
6. **Decrypt & Play** - View your cards and make betting decisions
7. **Showdown** - Best hand wins the pot!

## Project Structure

```
HiddenHand/
├── programs/
│   └── hiddenhand/src/
│       ├── lib.rs              # Program entry point (18 instructions)
│       ├── instructions/       # All instruction handlers
│       │   ├── create_table.rs
│       │   ├── join_table.rs
│       │   ├── start_hand.rs
│       │   ├── request_shuffle.rs
│       │   ├── callback_shuffle.rs    # VRF callback
│       │   ├── deal_cards_encrypted.rs # VRF + Inco encryption
│       │   ├── player_action.rs
│       │   ├── showdown.rs
│       │   ├── reveal_cards.rs        # Ed25519 verified reveals
│       │   ├── timeout_player.rs      # Timeout handling
│       │   ├── timeout_reveal.rs
│       │   ├── close_inactive_table.rs
│       │   └── ...
│       ├── state/              # Account structures
│       │   ├── table.rs
│       │   ├── hand.rs
│       │   ├── player.rs
│       │   ├── deck.rs
│       │   └── hand_eval.rs    # Poker hand evaluation
│       ├── inco_cpi.rs         # Inco FHE integration
│       └── error.rs            # 30+ custom errors
├── app/                        # Next.js frontend
│   ├── app/page.tsx           # Main game UI
│   ├── components/            # UI components
│   ├── hooks/
│   │   ├── usePokerGame.ts    # Game logic hook
│   │   └── usePokerProgram.ts # Anchor program hook
│   └── lib/
│       ├── inco.ts            # Inco SDK wrapper + Ed25519 signing
│       └── idl/               # Program IDL
├── tests/
│   └── hiddenhand.ts          # Integration tests
└── marketing/                  # Pitch materials
```

## Game Mechanics

### Card Encoding
- Cards are encoded as 0-51 (u8)
- Suit: `card / 13` (0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades)
- Rank: `card % 13` (0=2, 1=3, ..., 12=Ace)

### Hand Evaluation
Full Texas Hold'em hand rankings implemented on-chain:
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
- **Fold** - Give up your hand
- **Check** - Pass (when no bet to call)
- **Call** - Match the current bet
- **Raise** - Increase the bet
- **All-In** - Bet all your chips

## Hackathon

**Solana Privacy Hack** (January 12-30, 2025)

### Bounties Targeted
- Inco Gaming Track
- Open Track

### Submission Checklist
- [x] Open-source code
- [x] Deployed to Solana devnet
- [x] Documentation (this README)
- [x] 42 unit tests passing
- [x] Ed25519 signature verification for secure card reveals
- [ ] 3-minute demo video

## Future Improvements

- [ ] Multi-table tournaments
- [x] Side pots for all-in scenarios (implemented)
- [ ] Spectator mode
- [ ] Chat functionality
- [x] Mobile-responsive design
- [ ] Mainnet deployment
- [ ] Tournament mode with blind escalation

## Team

Built with love for the Solana Privacy Hack 2025.

## License

MIT

---

*HiddenHand. Poker you can verify.*
