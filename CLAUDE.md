# HiddenHand - Privacy Poker on Solana

## Conversation Context (IMPORTANT - READ FIRST)

This project was started for the **Solana Privacy Hack** hackathon (Jan 12-30, 2025). The user and Claude collaboratively designed and built the initial program structure.

### Key Decisions Made
1. **Project Choice**: We evaluated 5 privacy project ideas and chose **Privacy Poker** because:
   - User's escrow3 experience translates well (state machines, multi-party)
   - Clear scope (Texas Hold'em rules are standardized)
   - Exciting demo potential
   - Targets MagicBlock ($5K) + Open Track ($18K) = $23K bounty potential

2. **Privacy Approach**: Hybrid **MagicBlock VRF + Inco FHE** for ultimate privacy:
   - **MagicBlock VRF**: Provably fair card shuffling with verifiable randomness
   - **Inco FHE**: Fully Homomorphic Encryption for card privacy
     - Cards encrypted as u128 handles on-chain
     - Only card owner can decrypt (via allowances)
     - Ed25519 signature verification for reveals
     - **Cryptographic guarantee**: Cards are ALWAYS encrypted, even during computation

3. **Manual Inco CPI**: Built custom CPI module (`src/inco_cpi.rs`) for Inco integration to avoid SDK version conflicts.

### What's Built
- Full poker game state machine (7 phases)
- Table creation with configurable blinds
- Player join/leave with SOL buy-in
- Betting logic (Fold/Check/Call/Raise/AllIn)
- Pot management and action rotation
- Card encoding (0-51) with Inco FHE encryption
- **Hand evaluation algorithm** (best 5 from 7 cards)
- **Showdown with pot distribution** (handles split pots)
- **42 passing unit tests**
- **MagicBlock VRF Integration** - Provably fair card shuffling
- **Inco FHE Encryption** - Hole cards encrypted as u128 handles
- **Ed25519 Signature Verification** - Secure card reveals at showdown
- **Complete Next.js Frontend** - Playable poker UI with wallet integration
- **Client-side Decryption** - Players decrypt their own cards via Inco SDK
- **Authority AFK Recovery** - Non-authority players can continue game after 60s timeout

### Game Liveness (AFK Recovery)

The game includes robust timeout mechanisms to prevent games from getting stuck if a player or the table authority goes AFK:

1. **Player Action Timeout** (`timeout_player`): Force fold inactive players after timeout
2. **Showdown Reveal Timeout** (`timeout_reveal`): Auto-fold players who don't reveal cards at showdown
3. **Community Card Reveal Timeout** (`reveal_community`): Any player can reveal community cards after 60s if authority is AFK
4. **Community Card Allowances** (`grant_community_allowances`): All players receive decryption access for community cards after VRF shuffle

**Technical Details:**
- Timeout checks use Solana cluster time (not local time) to avoid clock synchronization issues
- 60-second timeout constant: `ALLOWANCE_TIMEOUT_SECONDS` in `constants.rs`
- Frontend uses `getBlockTime()` RPC call for accurate timeout validation

### What's Next
1. ~~Write tests for current poker logic~~ Done
2. ~~Integrate MagicBlock VRF for shuffling~~ Done
3. ~~Integrate Inco FHE for card encryption~~ Done
4. ~~Build Next.js frontend with game UI~~ Done
5. ~~Ed25519 signature verification for secure reveals~~ Done
6. Record demo video and submit

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
- **Program ID**: `HS3GdhRBU3jMT4G6ogKVktKaibqsMhPRhDhNsmgzeB8Q`

### MagicBlock VRF Integration
- **VRF SDK**: `ephemeral-vrf-sdk = "0.2.1"` - Verifiable random function
- **VRF Features**: Provably fair shuffling, callback-based randomness
- **Status**: Integrated and working (42 tests passing)

### Inco FHE Integration
- **Inco Lightning**: TEE-based FHE encryption for hole cards
- **Encryption**: Cards stored as u128 handles on-chain
- **Decryption**: Client-side via Inco SDK with wallet signing
- **Ed25519 Verification**: Covalidator signatures verify card reveals at showdown

### Frontend (Next.js)
- **Location**: `/app/`
- **Framework**: Next.js 15 with TypeScript
- **Wallet**: Solana Wallet Adapter
- **Status**: Complete and playable

## Game Architecture

### Card Representation
- Cards encoded as 0-51 (u8)
- Suit: card / 13 (0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades)
- Rank: card % 13 (0=2, 1=3, ..., 8=10, 9=J, 10=Q, 11=K, 12=A)
- Stored as encrypted `u128` handles via Inco FHE

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

## Current Instructions (19 total)

### Core Game Instructions

| Instruction | Description | Status |
|-------------|-------------|--------|
| `create_table` | Create poker table with blinds config | Done |
| `join_table` | Join table with SOL buy-in | Done |
| `leave_table` | Cash out and leave | Done |
| `start_hand` | Begin new hand, init deck | Done |
| `player_action` | Fold/Check/Call/Raise/AllIn | Done |
| `showdown` | Evaluate hands, determine winner, distribute pot | Done |
| `deal_cards` | Legacy shuffle for local testing | Done |

### MagicBlock VRF Instructions (Provably Fair Shuffling)

| Instruction | Description | Status |
|-------------|-------------|--------|
| `request_shuffle` | Request VRF randomness for card shuffle | Done |
| `callback_shuffle` | VRF callback - shuffles deck with randomness | Done |
| `deal_cards_vrf` | Deal hole cards after VRF shuffle | Done |

### Inco FHE Instructions (Encrypted Cards)

| Instruction | Description | Status |
|-------------|-------------|--------|
| `deal_cards_encrypted` | Shuffle + encrypt cards via Inco FHE | Done |
| `encrypt_hole_cards` | Encrypt dealt cards for a player | Done |
| `grant_card_allowance` | Authority grants decryption allowance | Done |
| `grant_own_allowance` | Player grants own allowance via signing | Done |
| `grant_community_allowances` | Grant community card access to all players | Done |
| `reveal_cards` | Reveal cards at showdown (Ed25519 verified) | Done |

### Timeout & Recovery Instructions

| Instruction | Description | Status |
|-------------|-------------|--------|
| `timeout_player` | Force fold inactive player | Done |
| `timeout_reveal` | Force reveal timeout at showdown | Done |
| `close_inactive_table` | Close abandoned table, return funds | Done |

## File Structure

```
hiddenhand/
├── programs/
│   └── hiddenhand/src/           # Main poker program
│       ├── lib.rs                # Program entry (19 instructions)
│       ├── constants.rs          # PDA seeds, game constants
│       ├── error.rs              # 30+ custom errors
│       ├── inco_cpi.rs           # Manual Inco CPI (no SDK)
│       ├── state/
│       │   ├── table.rs          # Table config, seat management
│       │   ├── hand.rs           # Hand phases, pot, betting round
│       │   ├── player.rs         # Player seat, chips, hole cards (u128 handles)
│       │   ├── deck.rs           # Deck state, card utilities
│       │   └── hand_eval.rs      # Hand evaluation (best 5 from 7)
│       └── instructions/
│           ├── create_table.rs
│           ├── join_table.rs
│           ├── leave_table.rs
│           ├── start_hand.rs
│           ├── player_action.rs
│           ├── deal_cards.rs           # Legacy shuffle (local testing)
│           ├── deal_cards_encrypted.rs # VRF + Inco encryption
│           ├── deal_cards_vrf.rs       # VRF shuffle + deal
│           ├── showdown.rs             # Winner determination
│           ├── reveal_cards.rs         # Ed25519 verified card reveal
│           ├── timeout_player.rs       # Force fold inactive players
│           ├── timeout_reveal.rs       # Force reveal at showdown
│           ├── close_inactive_table.rs # Return funds from abandoned table
│           ├── request_shuffle.rs      # VRF randomness request
│           ├── callback_shuffle.rs     # VRF callback, stores seed
│           ├── encrypt_hole_cards.rs   # Inco FHE encryption
│           ├── grant_own_allowance.rs  # Player grants decryption access
│           └── grant_community_allowances.rs  # Community card access for AFK recovery
├── app/                          # Next.js frontend (complete)
│   ├── app/page.tsx             # Main game UI
│   ├── components/              # UI components
│   ├── hooks/
│   │   ├── usePokerGame.ts      # Game logic hook
│   │   └── usePokerProgram.ts   # Anchor program hook
│   └── lib/
│       ├── inco.ts              # Inco SDK integration
│       └── idl/                 # Program IDL
├── tests/
│   └── hiddenhand.ts            # Integration tests
├── marketing/                   # Pitch materials
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

### MagicBlock VRF (Provably Fair Shuffling)
- [MagicBlock Docs](https://docs.magicblock.gg/)
- [VRF SDK](https://crates.io/crates/ephemeral-vrf-sdk)
- [Example: Roll Dice](https://github.com/magicblock-labs/roll-dice) - VRF pattern

### Inco FHE (Card Encryption)
- [Inco Network](https://inco.org/)
- [Inco Solana SDK](https://www.npmjs.com/package/@inco/solana-sdk)

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
