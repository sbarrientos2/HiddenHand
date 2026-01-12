# HiddenHand - Privacy Poker on Solana

## Conversation Context (IMPORTANT - READ FIRST)

This project was started for the **Solana Privacy Hack** hackathon (Jan 12-30, 2025). The user and Claude collaboratively designed and built the initial program structure.

### Key Decisions Made
1. **Project Choice**: We evaluated 5 privacy project ideas and chose **Privacy Poker** because:
   - User's escrow3 experience translates well (state machines, multi-party)
   - Inco provides cryptographic primitives (we don't build crypto from scratch)
   - Clear scope (Texas Hold'em rules are standardized)
   - Exciting demo potential
   - Targets Inco Gaming ($2K) + Open Track ($18K) = $20K bounty potential

2. **Privacy Approach**: Using Inco Lightning (TEE-based) for:
   - Encrypted card shuffling via `e_rand()`
   - Private hole cards (only you see your cards)
   - Hidden deck state

3. **Current Blocker**: Inco Lightning SDK (`inco-lightning = "0.1.4"`) requires Rust edition2024, which Anchor's internal BPF toolchain (Cargo 1.84) doesn't support yet. We removed the dependency temporarily to get the core poker logic compiling.

### What's Built
- Full poker game state machine (7 phases)
- Table creation with configurable blinds
- Player join/leave with SOL buy-in
- Betting logic (Fold/Check/Call/Raise/AllIn)
- Pot management and action rotation
- Card encoding (0-51) ready for encryption

### What's Next
1. Write tests for current poker logic
2. Start Next.js frontend with game UI
3. Either wait for Anchor update OR build external Inco integration
4. Deploy to devnet and demo

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

### Inco Lightning Integration (PENDING)
- **Program ID**: `5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj`
- **Crate**: `inco-lightning = { version = "0.1.4", features = ["cpi"] }`
- **Types**: `Euint128` (encrypted integers), `Ebool` (encrypted booleans)
- **Operations**: `e_add`, `e_sub`, `e_eq`, `e_ge`, `e_select`, `e_rand`
- **Status**: Blocked by toolchain compatibility (edition2024 required)

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
| `deal_cards` | Deal encrypted hole cards | TODO (needs Inco) |
| `reveal_community` | Reveal flop/turn/river | TODO |
| `showdown` | Reveal hands, determine winner | TODO |

## File Structure

```
hiddenhand/
├── programs/hiddenhand/src/
│   ├── lib.rs              # Program entry (5 instructions)
│   ├── constants.rs        # PDA seeds, game constants
│   ├── error.rs            # 25+ custom errors
│   ├── state/
│   │   ├── table.rs        # Table config, seat management
│   │   ├── hand.rs         # Hand phases, pot, betting round
│   │   ├── player.rs       # Player seat, chips, hole cards
│   │   └── deck.rs         # Encrypted deck, card utilities
│   └── instructions/
│       ├── create_table.rs
│       ├── join_table.rs
│       ├── leave_table.rs
│       ├── start_hand.rs
│       └── player_action.rs
├── app/                    # Frontend (TODO)
├── tests/
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

- [Hackathon Page](https://solana.com/privacyhack)
- [Inco Docs - Solana](https://docs.inco.org/svm/home)
- [Inco Rust SDK](https://docs.inco.org/svm/rust-sdk/overview)
- [Private Raffle Tutorial](https://docs.inco.org/svm/tutorials/private-raffle/program) - Similar pattern to poker
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
