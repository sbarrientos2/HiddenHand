use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

#[derive(Accounts)]
pub struct StartHand<'info> {
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
        init,
        payer = authority,
        space = HandState::SIZE,
        seeds = [HAND_SEED, table.key().as_ref(), &(table.hand_number + 1).to_le_bytes()],
        bump
    )]
    pub hand_state: Account<'info, HandState>,

    #[account(
        init,
        payer = authority,
        space = DeckState::SIZE,
        seeds = [DECK_SEED, table.key().as_ref(), &(table.hand_number + 1).to_le_bytes()],
        bump
    )]
    pub deck_state: Account<'info, DeckState>,

    pub system_program: Program<'info, System>,
}

/// Start a new hand
/// NOTE: This is a simplified version. Full implementation would:
/// 1. Use Inco CPI to generate encrypted random values for shuffling
/// 2. Deal encrypted cards to each player
/// For now, we set up the hand state and deck structure
pub fn handler(ctx: Context<StartHand>) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let clock = Clock::get()?;

    // Validate enough players
    require!(
        table.current_players >= MIN_PLAYERS,
        HiddenHandError::NotEnoughPlayers
    );

    require!(
        table.status == TableStatus::Waiting,
        HiddenHandError::HandAlreadyInProgress
    );

    // Increment hand number
    table.hand_number += 1;
    table.status = TableStatus::Playing;

    // Advance dealer button
    table.advance_dealer();

    // Calculate positions
    let dealer_pos = table.dealer_position;
    let max_players = table.max_players;

    // Find small blind and big blind positions
    let mut sb_pos = (dealer_pos + 1) % max_players;
    while !table.is_seat_occupied(sb_pos) {
        sb_pos = (sb_pos + 1) % max_players;
    }

    let mut bb_pos = (sb_pos + 1) % max_players;
    while !table.is_seat_occupied(bb_pos) {
        bb_pos = (bb_pos + 1) % max_players;
    }

    // First to act preflop is after big blind
    let mut action_pos = (bb_pos + 1) % max_players;
    while !table.is_seat_occupied(action_pos) {
        action_pos = (action_pos + 1) % max_players;
    }

    // Initialize hand state
    let hand_state = &mut ctx.accounts.hand_state;
    hand_state.table = table.key();
    hand_state.hand_number = table.hand_number;
    hand_state.phase = GamePhase::Dealing;
    hand_state.pot = 0;
    hand_state.current_bet = table.big_blind;
    hand_state.min_raise = table.big_blind;
    hand_state.dealer_position = dealer_pos;
    hand_state.action_on = action_pos;
    hand_state.community_cards = vec![255, 255, 255, 255, 255]; // 255 = not revealed
    hand_state.community_revealed = 0;
    hand_state.active_players = table.occupied_seats;
    hand_state.acted_this_round = 0;
    hand_state.active_count = table.current_players;
    hand_state.all_in_players = 0; // No one is all-in at start
    hand_state.last_action_slot = clock.slot;
    hand_state.hand_start_slot = clock.slot;
    hand_state.bump = ctx.bumps.hand_state;

    // Initialize deck state
    let deck_state = &mut ctx.accounts.deck_state;
    deck_state.hand = hand_state.key();
    deck_state.cards = [0u128; DECK_SIZE]; // Will be filled with encrypted values
    deck_state.deal_index = 0;
    deck_state.is_shuffled = false;
    deck_state.bump = ctx.bumps.deck_state;

    msg!(
        "Hand #{} started. Dealer: seat {}, SB: seat {}, BB: seat {}, Action: seat {}",
        table.hand_number,
        dealer_pos,
        sb_pos,
        bb_pos,
        action_pos
    );

    Ok(())
}

/// Context for dealing cards to a player
/// This would use Inco CPI to deal encrypted cards
#[derive(Accounts)]
pub struct DealCards<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
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

    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[player_seat.seat_index]],
        bump = player_seat.bump
    )]
    pub player_seat: Account<'info, PlayerSeat>,

    // TODO: Add Inco Lightning program for CPI
    // pub inco_program: Program<'info, IncoLightning>,
}

/// Deal encrypted hole cards to a player
/// NOTE: This is a placeholder. Real implementation uses Inco CPI
pub fn deal_cards_handler(ctx: Context<DealCards>) -> Result<()> {
    let hand_state = &ctx.accounts.hand_state;
    let deck_state = &mut ctx.accounts.deck_state;
    let player_seat = &mut ctx.accounts.player_seat;

    require!(
        hand_state.phase == GamePhase::Dealing,
        HiddenHandError::InvalidPhase
    );

    // Deal two cards to player
    // In real implementation, these would come from Inco encrypted shuffle
    let card1 = deck_state.deal_card().ok_or(HiddenHandError::InvalidCardIndex)?;
    let card2 = deck_state.deal_card().ok_or(HiddenHandError::InvalidCardIndex)?;

    player_seat.hole_card_1 = card1;
    player_seat.hole_card_2 = card2;
    player_seat.status = PlayerStatus::Playing;
    player_seat.reset_for_new_hand();

    msg!(
        "Dealt cards to player at seat {}",
        player_seat.seat_index
    );

    Ok(())
}
