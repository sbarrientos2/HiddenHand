# HiddenHand - Privacy Poker on Solana

## Conversation Context (IMPORTANT - READ FIRST)

This project was started for the **Solana Privacy Hack** hackathon (Jan 12-30, 2025). The user and Claude collaboratively designed and built the initial program structure.

### Key Decisions Made
1. **Project Choice**: We evaluated 5 privacy project ideas and chose **Privacy Poker** because:
   - User's escrow3 experience translates well (state machines, multi-party)
   - Clear scope (Texas Hold'em rules are standardized)
   - Exciting demo potential
   - Targets MagicBlock ($5K) + Open Track ($18K) = $23K bounty potential

2. **Privacy Approach**: Using **MagicBlock** (VRF + Ephemeral Rollups) for:
   - **VRF (Verifiable Random Function)**: Provably fair card shuffling using Curve25519 Ristretto + Schnorr signatures
   - **Private Ephemeral Rollups (PER)**: Private hole cards visible only to player via TEE-based rollups
   - **Low latency**: 10ms transactions instead of 400ms

3. **Previous Blocker (Resolved)**: Inco Lightning SDK required Rust edition2024. We pivoted to MagicBlock which has full Anchor compatibility.

### What's Built
- Full poker game state machine (7 phases)
- Table creation with configurable blinds
- Player join/leave with SOL buy-in
- Betting logic (Fold/Check/Call/Raise/AllIn)
- Pot management and action rotation
- Card encoding (0-51) ready for encryption
- **Hand evaluation algorithm** (best 5 from 7 cards)
- **Showdown with pot distribution** (handles split pots)
- **36 passing unit tests**
- **MagicBlock VRF Integration** - Provably fair card shuffling
- **MagicBlock ER Delegation** - Private hole cards via Ephemeral Rollups
- **mb-test program** - Learning/testing program for MagicBlock SDK

### What's Next
1. ~~Write tests for current poker logic~~ Done
2. ~~Integrate MagicBlock VRF for shuffling~~ Done
3. ~~Integrate MagicBlock ER for privacy~~ Done
4. Start Next.js frontend with game UI
5. Deploy to MagicBlock DevNet and test VRF/ER features
6. Demo and submit

---

## Overview
HiddenHand is a fully on-chain Texas Hold'em poker game with cryptographic privacy guarantees. Player hole cards are encrypted using Inco Lightning's TEE-based confidential computing, ensuring that only the card owner can see their hand while the game remains provably fair.

**Hackathon**: Solana Privacy Hack (Jan 12-30, 2025)
**Submission Due**: February 1, 2025
**Target Bounties**: Inco Gaming ($2K) + Open Track ($18K) = $20K potential

## Tech Stack

### Smart Contract (Anchor/Rust)
- **Location**: `/programs/hiddenhand/`
- **Framework**: Anchor 0.32.1
- **Network**: Solana Devnet
- **Program ID**: `7skCDLugS15d6cfrtZZCc5rpe5sDB998WjVBacP5qsTp`

### MagicBlock Integration (ACTIVE)
- **VRF SDK**: `ephemeral-vrf-sdk = "0.2.1"` - Verifiable random function
- **ER SDK**: `ephemeral-rollups-sdk = "0.6.5"` - Ephemeral Rollups for privacy
- **VRF Features**: Provably fair shuffling, callback-based randomness
- **ER Features**: Account delegation, private state, 10ms latency
- **Status**: Integrated and compiling (36 tests passing)

### Frontend (Next.js) - Planned
- **Location**: `/app/`
- **Framework**: Next.js with TypeScript
- **Wallet**: Solana Wallet Adapter

## Game Architecture

### Card Representation
- Cards encoded as 0-51 (u8)
- Suit: card / 13 (0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades)
- Rank: card % 13 (0=2, 1=3, ..., 8=10, 9=J, 10=Q, 11=K, 12=A)
- Will be stored as encrypted `Euint128` handles when Inco is integrated

### Game Phases
```
Dealing → PreFlop → Flop → Turn → River → Showdown → Settled
```

### PDAs
- **Table**: `["table", table_id]`
- **Player Seat**: `["seat", table_pubkey, seat_index]`
- **Hand State**: `["hand", table_pubkey, hand_number]`
- **Deck State**: `["deck", table_pubkey, hand_number]`
- **Vault**: `["vault", table_pubkey]`

## Current Instructions

| Instruction | Description | Status |
|-------------|-------------|--------|
| `create_table` | Create poker table with blinds config | Done |
| `join_table` | Join table with SOL buy-in | Done |
| `leave_table` | Cash out and leave | Done |
| `start_hand` | Begin new hand, init deck | Done |
| `player_action` | Fold/Check/Call/Raise/AllIn | Done |
| `deal_cards` | Shuffle deck, deal hole cards, post blinds | Done (legacy) |
| `showdown` | Evaluate hands, determine winner, distribute pot | Done |
| `reveal_community` | Reveal flop/turn/river | Auto (in player_action) |

### MagicBlock VRF Instructions (Provably Fair)

| Instruction | Description | Status |
|-------------|-------------|--------|
| `request_shuffle` | Request VRF randomness for card shuffle | Done |
| `callback_shuffle` | VRF callback - shuffles deck with randomness | Done |
| `deal_cards_vrf` | Deal hole cards after VRF shuffle | Done |

### MagicBlock ER Instructions (Privacy)

| Instruction | Description | Status |
|-------------|-------------|--------|
| `delegate_seat` | Delegate player seat to Ephemeral Rollup | Done |
| `undelegate_seat` | Commit state back to base layer | Done |

## File Structure

```
hiddenhand/
├── programs/
│   ├── hiddenhand/src/           # Main poker program
│   │   ├── lib.rs                # Program entry (12 instructions)
│   │   ├── constants.rs          # PDA seeds, game constants
│   │   ├── error.rs              # 26+ custom errors
│   │   ├── state/
│   │   │   ├── table.rs          # Table config, seat management
│   │   │   ├── hand.rs           # Hand phases, pot, betting round
│   │   │   ├── player.rs         # Player seat, chips, hole cards
│   │   │   ├── deck.rs           # Deck state, card utilities
│   │   │   └── hand_eval.rs      # Hand evaluation (best 5 from 7)
│   │   └── instructions/
│   │       ├── create_table.rs
│   │       ├── join_table.rs
│   │       ├── leave_table.rs
│   │       ├── start_hand.rs
│   │       ├── player_action.rs
│   │       ├── deal_cards.rs     # Legacy shuffle (local testing)
│   │       ├── showdown.rs       # Winner determination
│   │       ├── request_shuffle.rs    # VRF randomness request
│   │       ├── callback_shuffle.rs   # VRF callback, shuffles deck
│   │       ├── deal_cards_vrf.rs     # Deal after VRF shuffle
│   │       ├── delegate_seat.rs      # ER delegation for privacy
│   │       └── undelegate_seat.rs    # ER undelegation
│   └── mb-test/src/              # MagicBlock learning program
│       └── lib.rs                # VRF + ER test code
├── marketing/
│   ├── PITCH.md
│   ├── TAGLINES.md
│   ├── MAGICBLOCK_BENEFITS.md    # Why MagicBlock for poker
│   └── MAGICBLOCK_DEEP_DIVE.md   # Technical integration guide
├── app/                          # Frontend (in progress)
├── tests/
│   ├── hiddenhand.ts             # Main program tests
│   └── mb-test.ts                # MagicBlock SDK tests
├── Anchor.toml
└── CLAUDE.md
```

## Development Commands

```bash
# Build
anchor build

# Test
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Frontend (when created)
cd app && npm run dev
```

## Key Resources

### MagicBlock (Primary Privacy Stack)
- [MagicBlock Docs](https://docs.magicblock.gg/)
- [Ephemeral Rollups SDK](https://crates.io/crates/ephemeral-rollups-sdk)
- [VRF SDK](https://crates.io/crates/ephemeral-vrf-sdk)
- [MagicBlock DevNet](https://devnet.magicblock.app/)
- [Example: Roll Dice](https://github.com/magicblock-labs/roll-dice) - VRF pattern
- [Example: Private Payments](https://github.com/magicblock-labs/private-payments-demo) - PER pattern

### Hackathon
- [Hackathon Page](https://solana.com/privacyhack)
- [Privacy on Solana GitHub](https://github.com/catmcgee/privacy-on-solana)

## Hackathon Info

**Timeline**:
- Jan 12: Opening ceremony
- Jan 12-16: Workshops
- Jan 12-30: Hacking
- Feb 1: Submissions due
- Feb 10: Winners announced

**Submission Requirements**:
- Open-source code
- Deployed to devnet/mainnet
- 3-minute demo video
- Documentation

## Design Notes

- Dark theme with poker aesthetic (green felt, gold accents)
- Card reveal animations
- Sound effects for chips/cards
- Mobile-responsive

## User Background

The user has built a milestone-based escrow platform on Solana (escrow3) with:
- Full Anchor/Rust program
- Complex state machines
- Multi-party coordination
- Next.js frontend with wallet integration

This experience directly applies to HiddenHand's poker mechanics.
