//! Reveal community cards (flop/turn/river)
//!
//! This instruction reveals community cards that have been encrypted during
//! the VRF shuffle. Ed25519 signature verification ensures the revealed
//! values came from Inco's TEE decryption.
//!
//! Authorization:
//! - Authority can call immediately
//! - Any player can call after COMMUNITY_REVEAL_TIMEOUT_SECONDS (60s)
//!
//! Flow:
//! 1. Betting round completes, awaiting_community_reveal is set to true
//! 2. Caller decrypts community cards via Inco SDK (client-side)
//! 3. Caller submits this instruction with Ed25519 attestation
//! 4. Program verifies signatures and stores revealed cards
//! 5. Phase advances and play continues

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    self, load_current_index_checked, load_instruction_at_checked,
};
use sha2::{Digest, Sha256};

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, Table, TableStatus};

/// Ed25519 program ID for signature verification
pub const ED25519_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x03, 0x7d, 0x46, 0xd6, 0x7c, 0x93, 0xfb, 0xbe, 0x12, 0xf9, 0x42, 0x8f, 0x83, 0x8d, 0x40, 0xff,
    0x05, 0x70, 0x74, 0x49, 0x27, 0xf4, 0x8a, 0x64, 0xfc, 0xca, 0x70, 0x44, 0x80, 0x00, 0x00, 0x00,
]);

/// Inco covalidator public key for signature verification
/// Base58: 81owXEbskUpiLv3oNJN4cZxGr93U9MGH7Tt9AvYH2U4r
pub const INCO_COVALIDATOR_PUBKEY: [u8; 32] = [
    0x68, 0x36, 0xe2, 0x3c, 0x91, 0xc4, 0x84, 0xbd, 0xce, 0x98, 0xdf, 0x49, 0x91, 0x30, 0x3b, 0x29,
    0xcb, 0x3e, 0xa1, 0x34, 0x77, 0x0e, 0xb6, 0xa9, 0x51, 0xed, 0xd3, 0x80, 0xd0, 0x82, 0xe4, 0xf3,
];

#[derive(Accounts)]
pub struct RevealCommunity<'info> {
    /// Caller revealing the community cards
    /// Authority can call immediately, others must wait for timeout
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        mut,
        seeds = [HAND_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = hand_state.bump
    )]
    pub hand_state: Account<'info, HandState>,

    #[account(
        seeds = [DECK_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = deck_state.bump
    )]
    pub deck_state: Account<'info, DeckState>,

    /// Instructions sysvar for Ed25519 signature verification
    /// CHECK: Verified by address constraint
    #[account(address = instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

/// Create the message hash that Inco signs
/// Format: SHA256(handle_hex_ascii || plaintext_u128_le)
fn create_inco_message_hash(handle: u128, plaintext: u8) -> [u8; 32] {
    let mut hasher = Sha256::new();

    // Handle as hex string, each char converted to ASCII code
    let hex_string = format!("{:x}", handle);
    for c in hex_string.chars() {
        hasher.update([c as u8]);
    }

    // Plaintext as u128 little-endian (16 bytes)
    let plaintext_bytes = (plaintext as u128).to_le_bytes();
    hasher.update(plaintext_bytes);

    hasher.finalize().into()
}

/// Helper to verify Ed25519 signature data for a specific handle/plaintext pair
fn verify_ed25519_for_handle(data: &[u8], handle: u128, plaintext: u8) -> Result<bool> {
    // Expected size: 16 (header) + 32 (pubkey) + 64 (sig) + 32 (msg) = 144
    if data.len() < 144 {
        return Ok(false);
    }

    // Public key is at offset 16 (right after the 16-byte header)
    let pubkey_offset = 16;
    let pubkey = &data[pubkey_offset..pubkey_offset + 32];

    // Verify it's the Inco covalidator
    if pubkey != INCO_COVALIDATOR_PUBKEY {
        return Ok(false);
    }

    // Message hash is at offset 112 (after header + pubkey + signature)
    let message_offset = 112;
    let expected_hash = create_inco_message_hash(handle, plaintext);
    let actual_hash = &data[message_offset..message_offset + 32];

    Ok(actual_hash == expected_hash.as_slice())
}

/// Reveal community cards with Ed25519 signature verification
///
/// # Arguments
/// * `cards` - The revealed card values. Length depends on current phase:
///   - PreFlop -> Flop: 3 cards (or 5 if all-in runout)
///   - Flop -> Turn: 1 card (or 2 if all-in runout)
///   - Turn -> River: 1 card
pub fn handler(ctx: Context<RevealCommunity>, cards: Vec<u8>) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let deck_state = &ctx.accounts.deck_state;
    let caller = &ctx.accounts.caller;
    let clock = Clock::get()?;

    // Validate table is playing
    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    // Authorization check: authority can call immediately, others must wait for timeout
    let is_authority = table.authority == caller.key();
    if !is_authority {
        let elapsed = clock.unix_timestamp - hand_state.last_action_time;
        require!(
            elapsed >= ALLOWANCE_TIMEOUT_SECONDS,
            HiddenHandError::TimeoutNotReached
        );
        msg!("Non-authority revealing community cards after {} seconds timeout", elapsed);
    }

    // Must be waiting for community reveal
    require!(
        hand_state.awaiting_community_reveal,
        HiddenHandError::CommunityNotReady
    );

    // Validate phase
    require!(
        matches!(
            hand_state.phase,
            GamePhase::PreFlop | GamePhase::Flop | GamePhase::Turn
        ),
        HiddenHandError::InvalidPhase
    );

    // Get current instruction index for Ed25519 verification
    let current_ix_index = load_current_index_checked(&ctx.accounts.instructions_sysvar)
        .map_err(|_| HiddenHandError::Ed25519VerificationFailed)?;

    // Determine expected cards based on current phase and whether all players are all-in
    let all_in_runout = !hand_state.can_anyone_bet();
    let (expected_card_count, start_idx) = match hand_state.phase {
        GamePhase::PreFlop => {
            if all_in_runout {
                (5, 0) // All 5 community cards
            } else {
                (3, 0) // Flop: cards 0, 1, 2
            }
        }
        GamePhase::Flop => {
            if all_in_runout {
                (2, 3) // Turn + River: cards 3, 4
            } else {
                (1, 3) // Turn: card 3
            }
        }
        GamePhase::Turn => (1, 4), // River: card 4
        _ => return Err(HiddenHandError::InvalidPhase.into()),
    };

    // Validate card count
    require!(
        cards.len() == expected_card_count,
        HiddenHandError::InvalidCommunityCards
    );

    // Validate all cards are in valid range
    for card in &cards {
        require!(*card <= 51, HiddenHandError::InvalidCard);
    }

    // Verify Ed25519 signatures for each card
    // Ed25519 instructions should be before our instruction
    msg!(
        "Verifying {} Ed25519 signatures for community cards...",
        expected_card_count
    );

    for (i, &card_value) in cards.iter().enumerate() {
        let card_idx = start_idx + i;
        let handle = deck_state.cards[card_idx];

        // Ed25519 instruction for this card should be at (current_ix_index - expected_card_count + i)
        let ed25519_ix_index = (current_ix_index as usize)
            .checked_sub(expected_card_count)
            .ok_or(HiddenHandError::Ed25519VerificationFailed)?
            + i;

        let ed25519_ix = load_instruction_at_checked(ed25519_ix_index, &ctx.accounts.instructions_sysvar)
            .map_err(|_| HiddenHandError::Ed25519VerificationFailed)?;

        // Verify it's an Ed25519 program instruction
        require!(
            ed25519_ix.program_id == ED25519_PROGRAM_ID,
            HiddenHandError::Ed25519VerificationFailed
        );

        // Verify the signature data
        let verified = verify_ed25519_for_handle(&ed25519_ix.data, handle, card_value)?;
        require!(verified, HiddenHandError::Ed25519VerificationFailed);

        msg!(
            "Card {} verified: handle {} -> value {}",
            card_idx,
            handle,
            card_value
        );
    }

    msg!("All community card signatures verified!");

    // Store revealed cards
    for (i, &card_value) in cards.iter().enumerate() {
        let card_idx = start_idx + i;
        hand_state.community_cards[card_idx] = card_value;
    }

    // Update community revealed count
    hand_state.community_revealed = (start_idx + expected_card_count) as u8;

    // Find first active player left of dealer for betting
    let first_to_act = get_first_active_left_of_dealer(hand_state, table.max_players);

    // Advance phase
    if all_in_runout {
        // All remaining players are all-in, go to showdown
        hand_state.phase = GamePhase::Showdown;
        msg!(
            "All-in runout complete: {} community cards revealed. Advancing to Showdown",
            hand_state.community_revealed
        );
    } else {
        // Normal phase advancement
        match hand_state.phase {
            GamePhase::PreFlop => {
                hand_state.phase = GamePhase::Flop;
                hand_state.reset_betting_round();
                hand_state.action_on = first_to_act;
                msg!(
                    "Flop revealed: {}, {}, {}. Action on seat {}",
                    hand_state.community_cards[0],
                    hand_state.community_cards[1],
                    hand_state.community_cards[2],
                    first_to_act
                );
            }
            GamePhase::Flop => {
                hand_state.phase = GamePhase::Turn;
                hand_state.reset_betting_round();
                hand_state.action_on = first_to_act;
                msg!(
                    "Turn revealed: {}. Action on seat {}",
                    hand_state.community_cards[3],
                    first_to_act
                );
            }
            GamePhase::Turn => {
                hand_state.phase = GamePhase::River;
                hand_state.reset_betting_round();
                hand_state.action_on = first_to_act;
                msg!(
                    "River revealed: {}. Action on seat {}",
                    hand_state.community_cards[4],
                    first_to_act
                );
            }
            _ => {}
        }
    }

    // Clear the awaiting flag
    hand_state.awaiting_community_reveal = false;
    hand_state.last_action_time = clock.unix_timestamp;

    Ok(())
}

/// Find first active player to the left of dealer (for post-flop betting order)
fn get_first_active_left_of_dealer(hand_state: &HandState, max_players: u8) -> u8 {
    let dealer = hand_state.dealer_position;
    let mut pos = (dealer + 1) % max_players;

    for _ in 0..max_players {
        if hand_state.is_player_active(pos) && !hand_state.is_player_all_in(pos) {
            return pos;
        }
        pos = (pos + 1) % max_players;
    }

    // Fallback: return first active player even if all-in
    pos = (dealer + 1) % max_players;
    for _ in 0..max_players {
        if hand_state.is_player_active(pos) {
            return pos;
        }
        pos = (pos + 1) % max_players;
    }

    // Fallback (shouldn't happen with 2+ active players)
    dealer
}
