use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, Table, TableStatus};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    Fold,
    Check,
    Call,
    Raise { amount: u64 },
    AllIn,
}

#[derive(Accounts)]
pub struct PlayerAction<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

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

    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[player_seat.seat_index]],
        bump = player_seat.bump,
        constraint = player_seat.player == player.key() @ HiddenHandError::PlayerNotAtTable
    )]
    pub player_seat: Account<'info, PlayerSeat>,
}

pub fn handler(ctx: Context<PlayerAction>, action: Action) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &mut ctx.accounts.hand_state;
    let deck_state = &ctx.accounts.deck_state;
    let player_seat = &mut ctx.accounts.player_seat;
    let clock = Clock::get()?;

    // Validate game state
    require!(
        table.status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    require!(
        matches!(
            hand_state.phase,
            GamePhase::PreFlop | GamePhase::Flop | GamePhase::Turn | GamePhase::River
        ),
        HiddenHandError::InvalidPhase
    );

    require!(
        hand_state.action_on == player_seat.seat_index,
        HiddenHandError::NotPlayersTurn
    );

    require!(
        player_seat.can_act(),
        HiddenHandError::PlayerFolded
    );

    // Calculate amount to call
    let to_call = hand_state
        .current_bet
        .saturating_sub(player_seat.current_bet);

    match action {
        Action::Fold => {
            player_seat.fold();
            hand_state.fold_player(player_seat.seat_index);

            msg!("Player at seat {} folds", player_seat.seat_index);

            // Check if only one player remains
            if hand_state.active_count == 1 {
                // Hand ends, winner takes pot
                hand_state.phase = GamePhase::Settled;
                msg!("Hand ends - only one player remaining");
            }
        }

        Action::Check => {
            require!(to_call == 0, HiddenHandError::CannotCheck);
            msg!("Player at seat {} checks", player_seat.seat_index);
        }

        Action::Call => {
            require!(to_call > 0, HiddenHandError::InvalidAction);

            let actual_bet = player_seat.place_bet(to_call);
            hand_state.pot = hand_state.pot.saturating_add(actual_bet);

            msg!(
                "Player at seat {} calls {} (pot: {})",
                player_seat.seat_index,
                actual_bet,
                hand_state.pot
            );
        }

        Action::Raise { amount } => {
            // Raise must be at least min_raise above current bet
            let total_bet = player_seat.current_bet.saturating_add(amount);
            let raise_amount = total_bet.saturating_sub(hand_state.current_bet);

            require!(
                raise_amount >= hand_state.min_raise,
                HiddenHandError::RaiseTooSmall
            );

            let actual_bet = player_seat.place_bet(amount);
            hand_state.pot = hand_state.pot.saturating_add(actual_bet);

            // Update current bet and min raise
            let new_bet = player_seat.current_bet;
            if new_bet > hand_state.current_bet {
                hand_state.min_raise = new_bet.saturating_sub(hand_state.current_bet);
                hand_state.current_bet = new_bet;
                // Reset acted flags since there's a new bet to respond to
                hand_state.acted_this_round = 0;
            }

            msg!(
                "Player at seat {} raises to {} (pot: {})",
                player_seat.seat_index,
                new_bet,
                hand_state.pot
            );
        }

        Action::AllIn => {
            let all_in_amount = player_seat.chips;
            let actual_bet = player_seat.place_bet(all_in_amount);
            hand_state.pot = hand_state.pot.saturating_add(actual_bet);

            let new_bet = player_seat.current_bet;
            if new_bet > hand_state.current_bet {
                hand_state.min_raise = new_bet.saturating_sub(hand_state.current_bet);
                hand_state.current_bet = new_bet;
                hand_state.acted_this_round = 0;
            }

            msg!(
                "Player at seat {} goes all-in for {} (pot: {})",
                player_seat.seat_index,
                actual_bet,
                hand_state.pot
            );
        }
    }

    // Mark player as acted
    hand_state.mark_acted(player_seat.seat_index);
    player_seat.has_acted = true;
    hand_state.last_action_slot = clock.slot;

    // Advance action to next player
    if let Some(next_player) = hand_state.next_active_player(player_seat.seat_index, table.max_players) {
        // Check if they can still act (not all-in)
        // For now, simplified: just move to next
        hand_state.action_on = next_player;

        // Check if betting round is complete
        if hand_state.is_betting_complete() {
            advance_to_next_phase(hand_state, deck_state, table.max_players)?;
        }
    } else {
        // No more players to act
        hand_state.phase = GamePhase::Settled;
    }

    Ok(())
}

fn advance_to_next_phase(hand_state: &mut HandState, deck_state: &DeckState, max_players: u8) -> Result<()> {
    // Find first active player left of dealer for post-flop action
    let first_to_act = get_first_active_left_of_dealer(hand_state, max_players);

    match hand_state.phase {
        GamePhase::PreFlop => {
            hand_state.phase = GamePhase::Flop;
            hand_state.reset_betting_round();
            // Reveal flop (3 cards) from deck_state
            hand_state.community_cards[0] = (deck_state.cards[0] & 0xFF) as u8;
            hand_state.community_cards[1] = (deck_state.cards[1] & 0xFF) as u8;
            hand_state.community_cards[2] = (deck_state.cards[2] & 0xFF) as u8;
            hand_state.community_revealed = 3;
            hand_state.action_on = first_to_act;
            msg!("Advancing to Flop - cards: {}, {}, {}",
                hand_state.community_cards[0],
                hand_state.community_cards[1],
                hand_state.community_cards[2]);
        }
        GamePhase::Flop => {
            hand_state.phase = GamePhase::Turn;
            hand_state.reset_betting_round();
            // Reveal turn (4th card)
            hand_state.community_cards[3] = (deck_state.cards[3] & 0xFF) as u8;
            hand_state.community_revealed = 4;
            hand_state.action_on = first_to_act;
            msg!("Advancing to Turn - card: {}", hand_state.community_cards[3]);
        }
        GamePhase::Turn => {
            hand_state.phase = GamePhase::River;
            hand_state.reset_betting_round();
            // Reveal river (5th card)
            hand_state.community_cards[4] = (deck_state.cards[4] & 0xFF) as u8;
            hand_state.community_revealed = 5;
            hand_state.action_on = first_to_act;
            msg!("Advancing to River - card: {}", hand_state.community_cards[4]);
        }
        GamePhase::River => {
            hand_state.phase = GamePhase::Showdown;
            msg!("Advancing to Showdown");
        }
        _ => {}
    }

    Ok(())
}

/// Find first active player to the left of dealer (for post-flop betting order)
fn get_first_active_left_of_dealer(hand_state: &HandState, max_players: u8) -> u8 {
    let dealer = hand_state.dealer_position;
    let mut pos = (dealer + 1) % max_players;

    for _ in 0..max_players {
        if hand_state.is_player_active(pos) {
            return pos;
        }
        pos = (pos + 1) % max_players;
    }

    // Fallback (shouldn't happen with 2+ active players)
    dealer
}
