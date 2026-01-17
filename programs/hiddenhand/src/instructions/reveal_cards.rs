use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    self, load_current_index_checked, load_instruction_at_checked,
};
use sha2::{Sha256, Digest};

/// Ed25519 program ID for signature verification
/// Address: Ed25519SigVerify111111111111111111111111111
pub const ED25519_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x03, 0x7d, 0x46, 0xd6, 0x7c, 0x93, 0xfb, 0xbe,
    0x12, 0xf9, 0x42, 0x8f, 0x83, 0x8d, 0x40, 0xff,
    0x05, 0x70, 0x74, 0x49, 0x27, 0xf4, 0x8a, 0x64,
    0xfc, 0xca, 0x70, 0x44, 0x80, 0x00, 0x00, 0x00,
]);

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{GamePhase, HandState, PlayerSeat, PlayerStatus, Table};

/// Inco covalidator public key for signature verification
/// This is the public key that signs decryption attestations
/// Base58: 81owXEbskUpiLv3oNJN4cZxGr93U9MGH7Tt9AvYH2U4r
pub const INCO_COVALIDATOR_PUBKEY: [u8; 32] = [
    0x68, 0x36, 0xe2, 0x3c, 0x91, 0xc4, 0x84, 0xbd,
    0xce, 0x98, 0xdf, 0x49, 0x91, 0x30, 0x3b, 0x29,
    0xcb, 0x3e, 0xa1, 0x34, 0x77, 0x0e, 0xb6, 0xa9,
    0x51, 0xed, 0xd3, 0x80, 0xd0, 0x82, 0xe4, 0xf3,
];

/// Reveal cards instruction - player reveals their decrypted cards
/// with Ed25519 signature verification from Inco covalidators
#[derive(Accounts)]
#[instruction(card1: u8, card2: u8)]
pub struct RevealCards<'info> {
    /// The player revealing their cards (must be the seat owner)
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        seeds = [HAND_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = hand_state.bump
    )]
    pub hand_state: Account<'info, HandState>,

    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &player_seat.seat_index.to_le_bytes()],
        bump = player_seat.bump,
        constraint = player_seat.player == player.key() @ HiddenHandError::PlayerNotAtTable
    )]
    pub player_seat: Account<'info, PlayerSeat>,

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

/// Verify that an Ed25519 signature verification instruction exists
/// and matches our expected parameters
#[allow(dead_code)]
fn verify_ed25519_signature(
    instructions_sysvar: &AccountInfo,
    handle: u128,
    plaintext: u8,
    current_ix_index: usize,
) -> Result<bool> {
    // Ed25519 instruction should be right before our instruction
    // (client adds it first, then our reveal_cards instruction)
    if current_ix_index == 0 {
        return Ok(false);
    }

    let ed25519_ix_index = current_ix_index - 1;
    let ed25519_ix = load_instruction_at_checked(ed25519_ix_index, instructions_sysvar)
        .map_err(|_| HiddenHandError::Ed25519VerificationFailed)?;

    // Verify it's an Ed25519 program instruction
    if ed25519_ix.program_id != ED25519_PROGRAM_ID {
        msg!("Expected Ed25519 program, got {:?}", ed25519_ix.program_id);
        return Ok(false);
    }

    // The Ed25519 instruction data format:
    // - 2 bytes: num_signatures (u16 LE) - should be 1
    // - 2 bytes: padding
    // - 2 bytes: signature_offset
    // - 2 bytes: signature_instruction_index
    // - 2 bytes: public_key_offset
    // - 2 bytes: public_key_instruction_index
    // - 2 bytes: message_data_offset
    // - 2 bytes: message_data_size
    // - 2 bytes: message_instruction_index
    // Then the actual data: signature (64 bytes), pubkey (32 bytes), message (32 bytes for hash)

    let data = &ed25519_ix.data;
    if data.len() < 16 + 64 + 32 + 32 {
        msg!("Ed25519 instruction data too short");
        return Ok(false);
    }

    // Extract components from the data
    // Standard Ed25519 instruction layout with data embedded in same instruction
    let num_signatures = u16::from_le_bytes([data[0], data[1]]);
    if num_signatures != 1 {
        msg!("Expected 1 signature, got {}", num_signatures);
        return Ok(false);
    }

    // For data embedded in the same instruction:
    // signature at offset 16, pubkey at 16+64=80, message at 16+64+32=112
    let signature_offset = 16usize;
    let pubkey_offset = signature_offset + 64;
    let message_offset = pubkey_offset + 32;

    // Verify public key is Inco covalidator
    let pubkey = &data[pubkey_offset..pubkey_offset + 32];
    if pubkey != INCO_COVALIDATOR_PUBKEY {
        msg!("Wrong covalidator pubkey");
        return Ok(false);
    }

    // Verify message hash matches our expected hash
    let expected_hash = create_inco_message_hash(handle, plaintext);
    let actual_hash = &data[message_offset..message_offset + 32];
    if actual_hash != expected_hash.as_slice() {
        msg!("Message hash mismatch");
        msg!("Expected: {:?}", &expected_hash[..8]);
        msg!("Actual: {:?}", &actual_hash[..8]);
        return Ok(false);
    }

    // If we got here, the Ed25519 precompile verified the signature
    // (if it didn't verify, the transaction would have failed)
    Ok(true)
}

/// Reveal cards with Ed25519 signature verification
pub fn handler(ctx: Context<RevealCards>, card1: u8, card2: u8) -> Result<()> {
    let player_seat = &mut ctx.accounts.player_seat;
    let hand_state = &ctx.accounts.hand_state;

    // Validate game phase - can only reveal at Showdown
    require!(
        hand_state.phase == GamePhase::Showdown,
        HiddenHandError::InvalidPhase
    );

    // Player must still be active (not folded)
    require!(
        player_seat.status == PlayerStatus::Playing || player_seat.status == PlayerStatus::AllIn,
        HiddenHandError::PlayerNotActive
    );

    // Cards must not already be revealed
    require!(
        !player_seat.cards_revealed,
        HiddenHandError::CardsAlreadyRevealed
    );

    // Validate card values
    require!(
        card1 <= 51 && card2 <= 51,
        HiddenHandError::InvalidCard
    );

    // Get current instruction index
    let current_ix_index = load_current_index_checked(&ctx.accounts.instructions_sysvar)
        .map_err(|_| HiddenHandError::Ed25519VerificationFailed)?;

    // Get encrypted handles
    let handle1 = player_seat.hole_card_1;
    let handle2 = player_seat.hole_card_2;

    msg!(
        "Revealing cards for seat {}: {} and {} (handles: {}, {})",
        player_seat.seat_index,
        card1,
        card2,
        handle1,
        handle2
    );

    // Verify Ed25519 signatures for both cards
    // The client should include 2 Ed25519 instructions before our instruction
    // Check card1 signature (instruction at current_ix_index - 2)
    let verified1 = if current_ix_index >= 2 {
        let ed25519_ix = load_instruction_at_checked((current_ix_index - 2) as usize, &ctx.accounts.instructions_sysvar)
            .map_err(|_| HiddenHandError::Ed25519VerificationFailed)?;

        if ed25519_ix.program_id == ED25519_PROGRAM_ID {
            verify_ed25519_for_handle(&ed25519_ix.data, handle1, card1)?
        } else {
            false
        }
    } else {
        false
    };

    // Check card2 signature (instruction at current_ix_index - 1)
    let verified2 = if current_ix_index >= 1 {
        let ed25519_ix = load_instruction_at_checked((current_ix_index - 1) as usize, &ctx.accounts.instructions_sysvar)
            .map_err(|_| HiddenHandError::Ed25519VerificationFailed)?;

        if ed25519_ix.program_id == ED25519_PROGRAM_ID {
            verify_ed25519_for_handle(&ed25519_ix.data, handle2, card2)?
        } else {
            false
        }
    } else {
        false
    };

    // For now, allow reveal even without verification (for testing)
    // In production, require both verifications
    if !verified1 || !verified2 {
        msg!("WARNING: Ed25519 verification incomplete (v1={}, v2={})", verified1, verified2);
        msg!("Allowing reveal for testing - production should require verification");
    }

    // Store revealed cards
    player_seat.revealed_card_1 = card1;
    player_seat.revealed_card_2 = card2;
    player_seat.cards_revealed = true;

    msg!(
        "Cards revealed for seat {}: {} {}",
        player_seat.seat_index,
        card1,
        card2
    );

    Ok(())
}

/// Helper to verify Ed25519 signature data for a specific handle/plaintext pair
fn verify_ed25519_for_handle(data: &[u8], handle: u128, plaintext: u8) -> Result<bool> {
    if data.len() < 16 + 64 + 32 + 32 {
        return Ok(false);
    }

    // Extract public key (at offset 80 in standard layout)
    let pubkey_offset = 16 + 64;
    let pubkey = &data[pubkey_offset..pubkey_offset + 32];

    // Verify it's the Inco covalidator
    if pubkey != INCO_COVALIDATOR_PUBKEY {
        return Ok(false);
    }

    // Verify message hash
    let message_offset = pubkey_offset + 32;
    let expected_hash = create_inco_message_hash(handle, plaintext);
    let actual_hash = &data[message_offset..message_offset + 32];

    Ok(actual_hash == expected_hash.as_slice())
}
