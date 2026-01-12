use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

#[derive(Accounts)]
pub struct DealAllCards<'info> {
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

/// Deal cards to all players and post blinds
/// remaining_accounts should contain all OTHER player seats (not SB/BB)
pub fn handler(ctx: Context<DealAllCards>) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let deck_state = &mut ctx.accounts.deck_state;
    let sb_seat = &mut ctx.accounts.sb_seat;
    let bb_seat = &mut ctx.accounts.bb_seat;
    let clock = Clock::get()?;

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

    // Generate pseudorandom seed from slot hashes
    // In production, this would use Inco's e_rand()
    let slot_hash = clock.slot;
    let mut seed = slot_hash;

    // Fisher-Yates shuffle using slot as seed
    let mut deck: [u8; 52] = core::array::from_fn(|i| i as u8);

    for i in (1..52).rev() {
        // Simple LCG PRNG: seed = (seed * 1103515245 + 12345) % 2^64
        seed = seed.wrapping_mul(1103515245).wrapping_add(12345);
        let j = (seed % (i as u64 + 1)) as usize;
        deck.swap(i, j);
    }

    // Store shuffled deck as u128 (lower 8 bits = card value)
    // In production, these would be encrypted Inco handles
    for i in 0..52 {
        deck_state.cards[i] = deck[i] as u128;
    }
    deck_state.is_shuffled = true;

    // Store community cards in deck_state (first 5 cards)
    // They remain hidden in hand_state until revealed during phase transitions
    // Cards 0-4 are community cards, stored in deck_state.cards[0..5]
    // hand_state.community_cards uses 255 to indicate hidden cards
    hand_state.community_cards = vec![255, 255, 255, 255, 255];
    hand_state.community_revealed = 0;
    deck_state.deal_index = 5; // Community cards reserved at indices 0-4

    // Track seat indices
    let sb_index = sb_seat.seat_index;
    let bb_index = bb_seat.seat_index;

    // Deal to SB and BB first (they're in named accounts)
    // We'll deal to all players in seat order

    // Post blinds
    let sb_amount = sb_seat.place_bet(table.small_blind);
    let bb_amount = bb_seat.place_bet(table.big_blind);
    hand_state.pot = sb_amount + bb_amount;

    msg!("SB (seat {}) posts {}", sb_index, sb_amount);
    msg!("BB (seat {}) posts {}", bb_index, bb_amount);

    // Mark blinds as having acted (they've posted)
    // But they still need to act if there's a raise
    sb_seat.status = PlayerStatus::Playing;
    bb_seat.status = PlayerStatus::Playing;

    // Deal cards to SB and BB
    let mut deal_idx = deck_state.deal_index as usize;

    sb_seat.hole_card_1 = deck[deal_idx] as u128;
    sb_seat.hole_card_2 = deck[deal_idx + 1] as u128;
    deal_idx += 2;

    bb_seat.hole_card_1 = deck[deal_idx] as u128;
    bb_seat.hole_card_2 = deck[deal_idx + 1] as u128;
    deal_idx += 2;

    msg!("Dealt hole cards to SB (seat {})", sb_index);
    msg!("Dealt hole cards to BB (seat {})", bb_index);

    // Deal to other players via remaining_accounts
    for account_info in ctx.remaining_accounts.iter() {
        let data = account_info.try_borrow_data()?;
        if data.len() >= 8 {
            let seat = PlayerSeat::try_deserialize(&mut &data[..])?;

            // Skip SB and BB (already dealt)
            if seat.table == table.key() &&
               seat.seat_index != sb_index &&
               seat.seat_index != bb_index {
                drop(data);

                let mut data = account_info.try_borrow_mut_data()?;
                let mut seat = PlayerSeat::try_deserialize(&mut &data[..])?;

                seat.hole_card_1 = deck[deal_idx] as u128;
                seat.hole_card_2 = deck[deal_idx + 1] as u128;
                seat.status = PlayerStatus::Playing;
                seat.current_bet = 0;
                seat.total_bet_this_hand = 0;
                deal_idx += 2;

                msg!("Dealt hole cards to seat {}", seat.seat_index);

                seat.try_serialize(&mut *data)?;
            }
        }
    }

    deck_state.deal_index = deal_idx as u8;

    // Advance to PreFlop
    hand_state.phase = GamePhase::PreFlop;
    hand_state.last_action_slot = clock.slot;
    hand_state.all_in_players = 0; // No one is all-in yet

    msg!(
        "Cards dealt. Pot: {}. Phase: PreFlop. Action on seat {}",
        hand_state.pot,
        hand_state.action_on
    );

    Ok(())
}
