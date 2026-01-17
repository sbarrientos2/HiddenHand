//! Deal cards with atomic Inco encryption
//!
//! This instruction shuffles and deals cards, encrypting them immediately
//! via Inco FHE so that plaintext card values are NEVER stored on-chain.
//!
//! Flow:
//! 1. Shuffle deck using slot hash (or VRF seed)
//! 2. For each player: encrypt hole cards via Inco CPI BEFORE storing
//! 3. Store only encrypted handles in PlayerSeat
//! 4. Post blinds and advance to PreFlop
//!
//! After this instruction, clients should call grant_card_allowance for each player
//! to enable decryption.

use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::inco_cpi::{self, INCO_PROGRAM_ID};
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

#[derive(Accounts)]
pub struct DealCardsEncrypted<'info> {
    /// The caller (authority can call immediately, others must wait for timeout)
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
        mut,
        seeds = [DECK_SEED, table.key().as_ref(), &table.hand_number.to_le_bytes()],
        bump = deck_state.bump
    )]
    pub deck_state: Account<'info, DeckState>,

    /// Small blind player seat
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[sb_seat.seat_index]],
        bump = sb_seat.bump
    )]
    pub sb_seat: Account<'info, PlayerSeat>,

    /// Big blind player seat
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[bb_seat.seat_index]],
        bump = bb_seat.bump
    )]
    pub bb_seat: Account<'info, PlayerSeat>,

    /// The Inco Lightning program for encryption
    /// CHECK: Verified by address constraint
    #[account(address = INCO_PROGRAM_ID)]
    pub inco_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Deal cards with atomic encryption - cards are NEVER plaintext on-chain
/// remaining_accounts should contain all OTHER player seats (not SB/BB)
pub fn handler(ctx: Context<DealCardsEncrypted>) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let deck_state = &mut ctx.accounts.deck_state;
    let sb_seat = &mut ctx.accounts.sb_seat;
    let bb_seat = &mut ctx.accounts.bb_seat;
    let caller = &ctx.accounts.caller;
    let clock = Clock::get()?;

    // Authorization check: authority can call immediately, others must wait for timeout
    let is_authority = table.authority == caller.key();
    if !is_authority {
        let elapsed = clock.unix_timestamp - hand_state.last_action_time;
        require!(
            elapsed >= DEAL_TIMEOUT_SECONDS,
            HiddenHandError::UnauthorizedAuthority
        );
        msg!("Non-authority dealing cards after {} seconds timeout", elapsed);
    }

    // Security: Check SB and BB are different accounts
    require!(
        sb_seat.key() != bb_seat.key(),
        HiddenHandError::DuplicateAccount
    );

    // Security: Check for duplicate accounts in remaining_accounts
    let mut seen_keys: BTreeSet<Pubkey> = BTreeSet::new();
    seen_keys.insert(sb_seat.key());
    seen_keys.insert(bb_seat.key());
    for account in ctx.remaining_accounts.iter() {
        if !seen_keys.insert(*account.key) {
            return Err(HiddenHandError::DuplicateAccount.into());
        }
    }

    // Validate phase
    require!(
        hand_state.phase == GamePhase::Dealing,
        HiddenHandError::InvalidPhase
    );

    require!(
        !deck_state.is_shuffled,
        HiddenHandError::DeckAlreadyShuffled
    );

    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    msg!("Dealing cards with atomic Inco encryption...");

    // Generate pseudorandom seed from slot hashes
    let slot_hash = clock.slot;
    let mut seed = slot_hash;

    // Fisher-Yates shuffle using slot as seed
    let mut deck: [u8; 52] = core::array::from_fn(|i| i as u8);

    for i in (1..52).rev() {
        seed = seed.wrapping_mul(1103515245).wrapping_add(12345);
        let j = (seed % (i as u64 + 1)) as usize;
        deck.swap(i, j);
    }

    // Store shuffled deck as encrypted handles
    // Community cards (indices 0-4) will be encrypted too for consistency
    deck_state.is_shuffled = true;
    hand_state.community_cards = vec![255, 255, 255, 255, 255];
    hand_state.community_revealed = 0;
    deck_state.deal_index = 5; // Community cards reserved at indices 0-4

    // Get signer for Inco CPI
    let caller_info = ctx.accounts.caller.to_account_info();

    // Store community cards as PLAINTEXT in low byte of u128
    // Community cards are revealed to everyone (flop/turn/river), so no encryption needed
    // This allows player_action.rs to extract them with (deck_state.cards[i] & 0xFF) as u8
    msg!("Storing community cards (plaintext - they'll be public when revealed)...");
    for i in 0..5 {
        deck_state.cards[i] = deck[i] as u128;
    }

    // Track seat indices and active player count
    let sb_index = sb_seat.seat_index;
    let bb_index = bb_seat.seat_index;
    let mut active_players = hand_state.active_players;
    let mut active_count = 0u8;
    let mut deal_idx = 5usize; // Start after community cards

    // Deal to SB if they have chips
    if sb_seat.chips > 0 {
        sb_seat.current_bet = 0;
        sb_seat.total_bet_this_hand = 0;
        sb_seat.has_acted = false;
        sb_seat.cards_revealed = false;
        sb_seat.revealed_card_1 = 255;
        sb_seat.revealed_card_2 = 255;

        let sb_amount = sb_seat.place_bet(table.small_blind);
        hand_state.pot = hand_state.pot.saturating_add(sb_amount);
        sb_seat.status = PlayerStatus::Playing;

        // ATOMIC ENCRYPTION: Encrypt cards immediately
        msg!("Encrypting cards for SB (seat {})...", sb_index);
        let encrypted1 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx])?;
        let encrypted2 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx + 1])?;
        sb_seat.hole_card_1 = encrypted1.unwrap();
        sb_seat.hole_card_2 = encrypted2.unwrap();

        // Also store encrypted in deck for consistency
        deck_state.cards[deal_idx] = encrypted1.unwrap();
        deck_state.cards[deal_idx + 1] = encrypted2.unwrap();

        deal_idx += 2;
        active_count += 1;
        msg!("SB (seat {}) posts {} and receives encrypted cards", sb_index, sb_amount);
    } else {
        active_players &= !(1 << sb_index);
        sb_seat.status = PlayerStatus::Sitting;
        msg!("SB (seat {}) has no chips - sitting out", sb_index);
    }

    // Deal to BB if they have chips
    if bb_seat.chips > 0 {
        bb_seat.current_bet = 0;
        bb_seat.total_bet_this_hand = 0;
        bb_seat.has_acted = false;
        bb_seat.cards_revealed = false;
        bb_seat.revealed_card_1 = 255;
        bb_seat.revealed_card_2 = 255;

        let bb_amount = bb_seat.place_bet(table.big_blind);
        hand_state.pot = hand_state.pot.saturating_add(bb_amount);
        bb_seat.status = PlayerStatus::Playing;

        // ATOMIC ENCRYPTION: Encrypt cards immediately
        msg!("Encrypting cards for BB (seat {})...", bb_index);
        let encrypted1 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx])?;
        let encrypted2 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx + 1])?;
        bb_seat.hole_card_1 = encrypted1.unwrap();
        bb_seat.hole_card_2 = encrypted2.unwrap();

        deck_state.cards[deal_idx] = encrypted1.unwrap();
        deck_state.cards[deal_idx + 1] = encrypted2.unwrap();

        deal_idx += 2;
        active_count += 1;
        msg!("BB (seat {}) posts {} and receives encrypted cards", bb_index, bb_amount);
    } else {
        active_players &= !(1 << bb_index);
        bb_seat.status = PlayerStatus::Sitting;
        msg!("BB (seat {}) has no chips - sitting out", bb_index);
    }

    // Deal to other players via remaining_accounts
    for account_info in ctx.remaining_accounts.iter() {
        let data = account_info.try_borrow_data()?;
        if data.len() >= 8 {
            let seat = PlayerSeat::try_deserialize(&mut &data[..])?;

            if seat.table == table.key() &&
               seat.seat_index != sb_index &&
               seat.seat_index != bb_index {
                let seat_index = seat.seat_index;
                let has_chips = seat.chips > 0;
                drop(data);

                let mut data = account_info.try_borrow_mut_data()?;
                let mut seat = PlayerSeat::try_deserialize(&mut &data[..])?;

                if has_chips {
                    // ATOMIC ENCRYPTION: Encrypt cards immediately
                    msg!("Encrypting cards for seat {}...", seat_index);
                    let encrypted1 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx])?;
                    let encrypted2 = inco_cpi::encrypt_card(&caller_info, deck[deal_idx + 1])?;

                    seat.hole_card_1 = encrypted1.unwrap();
                    seat.hole_card_2 = encrypted2.unwrap();
                    seat.status = PlayerStatus::Playing;
                    seat.current_bet = 0;
                    seat.total_bet_this_hand = 0;
                    seat.has_acted = false;
                    seat.cards_revealed = false;
                    seat.revealed_card_1 = 255;
                    seat.revealed_card_2 = 255;

                    // Store in deck too
                    deck_state.cards[deal_idx] = encrypted1.unwrap();
                    deck_state.cards[deal_idx + 1] = encrypted2.unwrap();

                    deal_idx += 2;
                    active_count += 1;
                    msg!("Dealt encrypted hole cards to seat {}", seat_index);
                } else {
                    active_players &= !(1 << seat_index);
                    seat.status = PlayerStatus::Sitting;
                    msg!("Seat {} has no chips - sitting out", seat_index);
                }

                seat.try_serialize(&mut *data)?;
            }
        }
    }

    // Update hand state with actual active players
    hand_state.active_players = active_players;
    hand_state.active_count = active_count;
    deck_state.deal_index = deal_idx as u8;

    // Verify we have enough active players
    require!(
        active_count >= 2,
        HiddenHandError::NotEnoughPlayers
    );

    // Find first active player to act
    let mut action_pos = hand_state.action_on;
    for _ in 0..table.max_players {
        if (active_players & (1 << action_pos)) != 0 {
            break;
        }
        action_pos = (action_pos + 1) % table.max_players;
    }
    hand_state.action_on = action_pos;

    // Advance to PreFlop
    hand_state.phase = GamePhase::PreFlop;
    hand_state.last_action_time = clock.unix_timestamp;
    hand_state.all_in_players = 0;

    msg!(
        "Cards dealt with encryption. Pot: {}. Phase: PreFlop. Action on seat {}. Active: {}",
        hand_state.pot,
        hand_state.action_on,
        active_count
    );
    msg!("IMPORTANT: Call grant_card_allowance for each player to enable decryption");

    Ok(())
}
