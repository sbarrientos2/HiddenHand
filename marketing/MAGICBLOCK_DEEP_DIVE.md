# MagicBlock Deep Dive - Technical Analysis

## Executive Summary

After extensive research into MagicBlock's SDK, documentation, and example code, this document outlines exactly how to implement privacy for HiddenHand poker.

**Key Finding:** MagicBlock provides two distinct but complementary features:
1. **VRF** - Verifiable randomness for fair card shuffling
2. **PER** - Private Ephemeral Rollups for hidden card state

Both are production-ready and integrate cleanly with our existing Anchor program.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     SOLANA BASE LAYER                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ HiddenHand   │  │ Delegation   │  │ Permission   │          │
│  │ Program      │  │ Program      │  │ Program      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                  │                  │                 │
│         │    delegate()    │   createGroup()  │                 │
│         └──────────────────┴──────────────────┘                 │
│                            │                                    │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              PRIVATE EPHEMERAL ROLLUP (TEE)                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 Intel TDX Enclave                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │ PlayerSeat  │  │ PlayerSeat  │  │  HandState  │     │   │
│  │  │ (Player A)  │  │ (Player B)  │  │   (shared)  │     │   │
│  │  │             │  │             │  │             │     │   │
│  │  │ hole_card_1 │  │ hole_card_1 │  │ pot         │     │   │
│  │  │ hole_card_2 │  │ hole_card_2 │  │ phase       │     │   │
│  │  │ [PRIVATE]   │  │ [PRIVATE]   │  │ [PUBLIC]    │     │   │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘     │   │
│  │         │                │                               │   │
│  │    Only Player A    Only Player B                        │   │
│  │    can read         can read                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Auth: Wallet signature → Session token → Permissioned reads   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 1: VRF (Verifiable Random Function)

### What It Does
- Generates **cryptographically secure randomness** on-chain
- Uses Curve25519 Ristretto + Schnorr signatures (RFC 9381)
- **Provably fair** - anyone can verify the randomness was generated correctly
- Returns 32 bytes of randomness

### Why We Need It
Our current shuffle:
```rust
// INSECURE: Predictable!
let slot_hash = clock.slot;
let mut seed = slot_hash;
```

Validators see the slot before users. A malicious validator could predict cards.

### How It Works

**Step 1: Request Randomness**
```rust
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

#[vrf]
#[derive(Accounts)]
pub struct RequestShuffle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub deck_state: Account<'info, DeckState>,

    /// CHECK: The oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

pub fn request_shuffle(ctx: Context<RequestShuffle>, client_seed: u8) -> Result<()> {
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: ID,
        callback_discriminator: instruction::CallbackShuffle::DISCRIMINATOR.to_vec(),
        caller_seed: [client_seed; 32],
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: ctx.accounts.deck_state.key(),
            is_signer: false,
            is_writable: true,
        }]),
        ..Default::default()
    });

    ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}
```

**Step 2: Receive Callback with Randomness**
```rust
#[derive(Accounts)]
pub struct CallbackShuffle<'info> {
    /// VRF program identity - ensures callback is from VRF program
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

    #[account(mut)]
    pub deck_state: Account<'info, DeckState>,
}

pub fn callback_shuffle(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
    let deck = &mut ctx.accounts.deck_state;

    // Use randomness for Fisher-Yates shuffle
    let mut cards: [u8; 52] = core::array::from_fn(|i| i as u8);
    let mut rand_idx = 0;

    for i in (1..52).rev() {
        // Get next random byte, cycling through the 32 bytes
        let rand_byte = randomness[rand_idx % 32];
        rand_idx += 1;

        let j = (rand_byte as usize) % (i + 1);
        cards.swap(i, j);
    }

    // Store shuffled deck
    for i in 0..52 {
        deck.cards[i] = cards[i] as u128;
    }
    deck.is_shuffled = true;

    Ok(())
}
```

### Cargo.toml Addition
```toml
[dependencies]
ephemeral-vrf-sdk = { version = "0.6.5", features = ["anchor"] }
```

---

## Part 2: PER (Private Ephemeral Rollups)

### What It Does
- Runs Solana validator inside **Intel TDX TEE** (hardware enclave)
- State is encrypted at rest, decrypted only inside the enclave
- **Permission system** controls who can read what accounts
- Sub-50ms latency for transactions

### Why We Need It
Currently, anyone can read hole cards:
```bash
# Anyone can run this and see all cards
anchor account PlayerSeat <address>
```

With PER, unauthorized reads return nothing/encrypted data.

### How It Works

**Step 1: Add SDK Macros**
```rust
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use ephemeral_rollups_sdk::access_control::{
    CreateGroupCpiBuilder, CreatePermissionCpiBuilder,
};

#[ephemeral]  // <-- Required for PER support
#[program]
pub mod hiddenhand {
    // ... program code
}
```

**Step 2: Mark Delegatable Accounts**
```rust
#[delegate]
#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct DelegateSeat<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The seat to delegate
    #[account(mut, del)]  // <-- 'del' marks as delegatable
    pub seat: AccountInfo<'info>,
}

pub fn delegate_seat(ctx: Context<DelegateSeat>, seat_index: u8) -> Result<()> {
    ctx.accounts.delegate_seat(
        &ctx.accounts.payer,
        &[SEAT_SEED, table.key().as_ref(), &[seat_index]],
        DelegateConfig::default(),
    )?;
    Ok(())
}
```

**Step 3: Create Permission Groups**
```rust
#[derive(Accounts)]
pub struct CreateSeatPermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub player: Signer<'info>,  // The player who will own this permission

    #[account(
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat.seat_index]],
        bump
    )]
    pub seat: Account<'info, PlayerSeat>,

    /// CHECK: Permission PDA
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,

    /// CHECK: Group PDA
    #[account(mut)]
    pub group: UncheckedAccount<'info>,

    /// CHECK: Permission program
    pub permission_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_seat_permission(ctx: Context<CreateSeatPermission>, group_id: Pubkey) -> Result<()> {
    // Create a permission group with the player as the only member
    CreateGroupCpiBuilder::new(&ctx.accounts.permission_program)
        .group(&ctx.accounts.group)
        .id(group_id)
        .members(vec![ctx.accounts.player.key()])  // Only this player
        .payer(&ctx.accounts.payer)
        .system_program(&ctx.accounts.system_program)
        .invoke()?;

    // Create permission linking the seat account to this group
    CreatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
        .permission(&ctx.accounts.permission)
        .delegated_account(&ctx.accounts.seat.to_account_info())
        .group(&ctx.accounts.group)
        .payer(&ctx.accounts.payer)
        .system_program(&ctx.accounts.system_program)
        .invoke_signed(&[&[
            SEAT_SEED,
            ctx.accounts.seat.table.as_ref(),
            &[ctx.accounts.seat.seat_index],
            &[ctx.bumps.seat],
        ]])?;

    Ok(())
}
```

**Step 4: Client Authentication**
```typescript
import { getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk';

// Authenticate to read private state
const authToken = await getAuthToken(
    EPHEMERAL_RPC_URL,
    wallet.publicKey,
    signMessage  // Wallet's signMessage function
);

// Now use this token for queries
const connection = new Connection(EPHEMERAL_RPC_URL, {
    httpHeaders: { Authorization: `Bearer ${authToken}` }
});

// Only the seat owner can successfully fetch their hole cards
const seat = await program.account.playerSeat.fetch(seatPDA);
console.log(seat.holeCard1, seat.holeCard2);  // Works only for owner
```

### Cargo.toml Addition
```toml
[dependencies]
ephemeral-rollups-sdk = { version = "0.6.5", features = ["anchor", "access-control"] }
```

---

## Part 3: Complete Integration Flow for Poker

### Game Flow with MagicBlock

```
1. CREATE TABLE (Base Layer)
   └── Table account created on Solana

2. JOIN TABLE (Base Layer)
   ├── PlayerSeat account created
   ├── SOL transferred to vault
   └── Permission group created for player

3. START HAND (Base Layer)
   ├── HandState + DeckState created
   └── All seat accounts delegated to PER

4. DEAL CARDS (PER)
   ├── Request VRF randomness
   ├── Callback shuffles deck
   └── Hole cards assigned (private to each player)

5. BETTING ROUNDS (PER)
   ├── Player actions (fold/check/call/raise)
   ├── Community cards revealed at phase transitions
   └── All at sub-50ms latency

6. SHOWDOWN (PER)
   ├── Remaining players reveal cards
   ├── Winner determined
   └── Pot distributed

7. END HAND (Base Layer)
   ├── Accounts committed back to Solana
   ├── Accounts undelegated
   └── Final state visible on-chain
```

### Key Program Changes

```rust
// lib.rs - Add these instructions

pub mod hiddenhand {
    // Existing instructions...

    // NEW: VRF-based shuffle
    pub fn request_shuffle(ctx: Context<RequestShuffle>, seed: u8) -> Result<()>;
    pub fn callback_shuffle(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()>;

    // NEW: PER delegation
    pub fn delegate_seat(ctx: Context<DelegateSeat>, seat_index: u8) -> Result<()>;
    pub fn delegate_hand(ctx: Context<DelegateHand>) -> Result<()>;
    pub fn create_seat_permission(ctx: Context<CreateSeatPermission>, group_id: Pubkey) -> Result<()>;
    pub fn commit_and_undelegate(ctx: Context<CommitAndUndelegate>) -> Result<()>;
}
```

---

## Part 4: Test Program Plan

Before modifying HiddenHand, create a minimal test:

```
programs/mb-test/
├── Cargo.toml
└── src/
    └── lib.rs
```

**Test Cases:**
1. **VRF Test**: Request randomness, verify callback receives 32 bytes
2. **Delegation Test**: Delegate account, run tx on ER, undelegate
3. **Permission Test**: Create group, create permission, verify access control
4. **Privacy Test**: Two users, each with private data, verify isolation

---

## Part 5: Endpoints and Constants

### MagicBlock Infrastructure

| Environment | RPC Endpoint | WebSocket |
|-------------|--------------|-----------|
| DevNet | `https://devnet.magicblock.app` | `wss://devnet.magicblock.app` |
| DevNet Asia | `https://devnet-as.magicblock.app` | `wss://devnet-as.magicblock.app` |
| TEE DevNet | `https://tee.magicblock.app` | - |
| Localnet | `http://localhost:8899` | `ws://localhost:8900` |

### Program IDs

```rust
// Delegation Program (from SDK)
use ephemeral_rollups_sdk::id;  // Returns delegation program ID

// Permission Program (from SDK)
use ephemeral_rollups_sdk::access_control::PERMISSION_PROGRAM_ID;

// VRF Constants
use ephemeral_vrf_sdk::consts::DEFAULT_QUEUE;       // Oracle queue
use ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY; // For callback verification

// Local Validator Identity (for localnet testing)
pub const LOCAL_VALIDATOR: &str = "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev";

// TEE Validator (for production)
pub const TEE_VALIDATOR: &str = "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA";
```

---

## Part 6: Dependencies Summary

### Cargo.toml
```toml
[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
ephemeral-rollups-sdk = { version = "0.6.5", features = ["anchor", "access-control"] }
ephemeral-vrf-sdk = { version = "0.6.5", features = ["anchor"] }
```

### package.json
```json
{
  "dependencies": {
    "@coral-xyz/anchor": "^0.32.1",
    "@magicblock-labs/ephemeral-rollups-sdk": "^0.6.5",
    "@solana/web3.js": "^1.95.0"
  }
}
```

---

## Conclusion

MagicBlock provides exactly what we need:

1. **VRF** → Fair, verifiable card shuffling (replaces our insecure slot-based PRNG)
2. **PER** → True privacy for hole cards (not just UI hiding)

The integration is straightforward:
- Add 2 Rust crates
- Add SDK macros to existing code
- Create permission groups for each player
- Update frontend to authenticate for private reads

**Estimated effort:**
- Test program: 2-4 hours
- HiddenHand integration: 4-8 hours
- Frontend updates: 2-4 hours

---

*Document created: January 2025*
*Based on: MagicBlock SDK v0.6.5, Anchor v0.32.1*
*Sources: magicblock-engine-examples, private-payments-demo, docs.magicblock.gg*
