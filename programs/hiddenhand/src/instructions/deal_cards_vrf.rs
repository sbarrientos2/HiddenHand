use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

/// Deal cards after VRF shuffle has completed
/// This instruction distributes hole cards and posts blinds
/// Use this after request_shuffle + callback_shuffle for provably fair games
#[derive(Accounts)]
pub struct DealCardsVrf<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.as_ref()],
        bump = table.bump,
        constraint = table.authority == authority.key() @ HiddenHandError::UnauthorizedAuthority
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
}

/// Deal hole cards to all players and post blinds (after VRF shuffle)
/// remaining_accounts should contain all OTHER player seats (not SB/BB)
pub fn handler(ctx: Context<DealCardsVrf>) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let deck_state = &mut ctx.accounts.deck_state;
    let sb_seat = &mut ctx.accounts.sb_seat;
    let bb_seat = &mut ctx.accounts.bb_seat;
    let clock = Clock::get()?;

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

    // REQUIRE deck is already shuffled (by VRF)
    require!(
        deck_state.is_shuffled,
        HiddenHandError::DeckNotShuffled
    );

    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    // Read shuffled cards from deck_state
    let deck: Vec<u8> = deck_state.cards.iter().map(|c| *c as u8).collect();

    // Track seat indices and active player count
    let sb_index = sb_seat.seat_index;
    let bb_index = bb_seat.seat_index;
    let mut active_players = hand_state.active_players;
    let mut active_count = 0u8;
    let mut deal_idx = deck_state.deal_index as usize;

    // Deal to SB if they have chips
    if sb_seat.chips > 0 {
        // Reset bet tracking for new hand before posting blind
        sb_seat.current_bet = 0;
        sb_seat.total_bet_this_hand = 0;
        sb_seat.has_acted = false;

        let sb_amount = sb_seat.place_bet(table.small_blind);
        hand_state.pot = hand_state.pot.saturating_add(sb_amount);
        sb_seat.status = PlayerStatus::Playing;
        sb_seat.hole_card_1 = deck[deal_idx] as u128;
        sb_seat.hole_card_2 = deck[deal_idx + 1] as u128;
        deal_idx += 2;
        active_count += 1;
        msg!("SB (seat {}) posts {} and receives cards", sb_index, sb_amount);
    } else {
        // Remove from active players - no chips
        active_players &= !(1 << sb_index);
        sb_seat.status = PlayerStatus::Sitting;
        msg!("SB (seat {}) has no chips - sitting out", sb_index);
    }

    // Deal to BB if they have chips
    if bb_seat.chips > 0 {
        // Reset bet tracking for new hand before posting blind
        bb_seat.current_bet = 0;
        bb_seat.total_bet_this_hand = 0;
        bb_seat.has_acted = false;

        let bb_amount = bb_seat.place_bet(table.big_blind);
        hand_state.pot = hand_state.pot.saturating_add(bb_amount);
        bb_seat.status = PlayerStatus::Playing;
        bb_seat.hole_card_1 = deck[deal_idx] as u128;
        bb_seat.hole_card_2 = deck[deal_idx + 1] as u128;
        deal_idx += 2;
        active_count += 1;
        msg!("BB (seat {}) posts {} and receives cards", bb_index, bb_amount);
    } else {
        // Remove from active players - no chips
        active_players &= !(1 << bb_index);
        bb_seat.status = PlayerStatus::Sitting;
        msg!("BB (seat {}) has no chips - sitting out", bb_index);
    }

    // Deal to other players via remaining_accounts
    for account_info in ctx.remaining_accounts.iter() {
        let data = account_info.try_borrow_data()?;
        if data.len() >= 8 {
            let seat = PlayerSeat::try_deserialize(&mut &data[..])?;

            // Skip SB and BB (already handled)
            if seat.table == table.key() &&
               seat.seat_index != sb_index &&
               seat.seat_index != bb_index {
                let seat_index = seat.seat_index;
                let has_chips = seat.chips > 0;
                drop(data);

                let mut data = account_info.try_borrow_mut_data()?;
                let mut seat = PlayerSeat::try_deserialize(&mut &data[..])?;

                if has_chips {
                    // Player has chips - deal cards
                    seat.hole_card_1 = deck[deal_idx] as u128;
                    seat.hole_card_2 = deck[deal_idx + 1] as u128;
                    seat.status = PlayerStatus::Playing;
                    seat.current_bet = 0;
                    seat.total_bet_this_hand = 0;
                    deal_idx += 2;
                    active_count += 1;
                    msg!("Dealt hole cards to seat {}", seat_index);
                } else {
                    // Player has no chips - sit them out
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

    // Find first active player to act (may need to skip players with no chips)
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
    hand_state.all_in_players = 0; // No one is all-in yet

    msg!(
        "VRF-shuffled cards dealt. Pot: {}. Phase: PreFlop. Action on seat {}. Active players: {}",
        hand_state.pot,
        hand_state.action_on,
        active_count
    );

    Ok(())
}
