use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

#[derive(Accounts)]
pub struct DealAllCards<'info> {
    /// Anyone can call, but non-authority must wait for timeout
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
}

/// Deal cards to all players and post blinds
/// Authority can call immediately, anyone else must wait for timeout
/// remaining_accounts should contain all OTHER player seats (not SB/BB)
pub fn handler(ctx: Context<DealAllCards>) -> Result<()> {
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

    // Get program ID for validation
    let program_id = crate::ID;
    let table_key = table.key();

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
        // Security check 1: Verify account is owned by our program
        if account_info.owner != &program_id {
            continue;
        }

        let data = account_info.try_borrow_data()?;
        if data.len() >= 8 {
            let seat = PlayerSeat::try_deserialize(&mut &data[..])?;

            // Security check 2: Verify this seat belongs to this table
            // Skip SB and BB (already handled)
            if seat.table == table_key &&
               seat.seat_index != sb_index &&
               seat.seat_index != bb_index {

                // Security check 3: Verify PDA derivation
                let (expected_pda, _) = Pubkey::find_program_address(
                    &[SEAT_SEED, table_key.as_ref(), &[seat.seat_index]],
                    &program_id,
                );
                if *account_info.key != expected_pda {
                    drop(data);
                    continue;
                }

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
        "Cards dealt. Pot: {}. Phase: PreFlop. Action on seat {}. Active players: {}",
        hand_state.pot,
        hand_state.action_on,
        active_count
    );

    Ok(())
}
