use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::inco_cpi::{self, INCO_PROGRAM_ID};
use crate::state::{DeckState, GamePhase, HandState, PlayerSeat, PlayerStatus, Table, TableStatus};

/// VRF callback for card shuffling - ATOMIC SHUFFLE + ENCRYPT
///
/// This instruction is called by the VRF oracle with the randomness.
/// It shuffles the deck AND encrypts cards in a single atomic transaction.
/// The VRF seed is NEVER stored in account state - only used in memory.
///
/// Expected remaining_accounts order:
/// [0] = inco_program
/// [1] = system_program
/// [2..] = player seat accounts
#[derive(Accounts)]
pub struct CallbackShuffle<'info> {
    /// CHECK: VRF program identity - ensures callback is from VRF program
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

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
    // remaining_accounts:
    // [0] = inco_program
    // [1] = system_program
    // [2..] = player seat accounts
}

/// VRF callback - receives randomness and ATOMICALLY shuffles + encrypts cards
///
/// SECURITY: The VRF seed is NEVER stored in account state!
/// It only exists in memory during this transaction's execution.
/// This eliminates the account state leak vector.
pub fn handler(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
    let clock = Clock::get()?;

    // Extract all needed values before mutable borrows
    let table_key = ctx.accounts.table.key();
    let hand_number = ctx.accounts.table.hand_number;
    let dealer_pos = ctx.accounts.table.dealer_position;
    let max_players = ctx.accounts.table.max_players;
    let small_blind = ctx.accounts.table.small_blind;
    let big_blind = ctx.accounts.table.big_blind;
    let table_status = ctx.accounts.table.status;
    let current_players = ctx.accounts.table.current_players;
    let occupied_seats = ctx.accounts.table.occupied_seats;

    let deck_bump = ctx.accounts.deck_state.bump;
    let deck_is_shuffled = ctx.accounts.deck_state.is_shuffled;

    let initial_active_players = ctx.accounts.hand_state.active_players;

    // Get account info for CPI before mutable borrows
    let deck_state_info = ctx.accounts.deck_state.to_account_info();

    msg!(
        "VRF callback received for hand #{}. Starting atomic shuffle + encrypt.",
        hand_number
    );
    msg!("Randomness (first 8 bytes): {:?}", &randomness[0..8]);

    // Validate state
    require!(
        table_status == TableStatus::Playing,
        HiddenHandError::HandNotInProgress
    );

    require!(
        !deck_is_shuffled,
        HiddenHandError::DeckAlreadyShuffled
    );

    // Parse remaining accounts
    require!(
        ctx.remaining_accounts.len() >= 3, // inco_program + system_program + at least 1 seat
        HiddenHandError::NotEnoughPlayers
    );

    let inco_program = &ctx.remaining_accounts[0];
    let _system_program = &ctx.remaining_accounts[1];
    let seat_accounts = &ctx.remaining_accounts[2..];

    // Verify Inco program
    require!(
        inco_program.key() == INCO_PROGRAM_ID,
        HiddenHandError::InvalidAction
    );

    // Security: Check for duplicate seat accounts
    let mut seen_keys: BTreeSet<Pubkey> = BTreeSet::new();
    for account in seat_accounts.iter() {
        if !seen_keys.insert(*account.key) {
            return Err(HiddenHandError::DuplicateAccount.into());
        }
    }

    // Get program ID for validation
    let program_id = crate::ID;

    // ============================================================
    // SHUFFLE THE DECK IN MEMORY (seed never stored!)
    // ============================================================
    msg!("Shuffling deck using VRF randomness...");

    // Initialize deck with cards 0-51
    let mut deck: [u8; 52] = core::array::from_fn(|i| i as u8);

    // Convert randomness to u64 seed for Fisher-Yates shuffle
    let mut seed = u64::from_le_bytes(randomness[0..8].try_into().unwrap());

    // Fisher-Yates shuffle using VRF randomness
    for i in (1..52).rev() {
        // Use different parts of randomness for each iteration
        if i % 4 == 0 && i < 28 {
            // Mix in more randomness periodically
            let offset = (i / 4) * 8;
            if offset + 8 <= 32 {
                seed ^= u64::from_le_bytes(randomness[offset..offset + 8].try_into().unwrap());
            }
        }

        // LCG step with VRF-seeded state
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let j = (seed % (i as u64 + 1)) as usize;
        deck.swap(i, j);
    }

    msg!("Deck shuffled. Now encrypting ALL cards (community + hole cards) via Inco FHE...");

    // ============================================================
    // ENCRYPT AND DEAL CARDS ATOMICALLY
    // Use deck_state PDA as signer for Inco CPI
    // ============================================================

    // Store table_key bytes for seeds (needs to live long enough)
    let table_key_bytes = table_key.to_bytes();
    let hand_number_bytes = hand_number.to_le_bytes();
    let bump_bytes = [deck_bump];

    let deck_seeds: &[&[u8]] = &[
        DECK_SEED,
        &table_key_bytes,
        &hand_number_bytes,
        &bump_bytes,
    ];

    let mut active_players = initial_active_players;
    let mut active_count = 0u8;
    let mut total_blinds_posted = 0u64;

    // ============================================================
    // ENCRYPT COMMUNITY CARDS (cards 0-4) - PRIVACY FIX
    // These are encrypted so no one can read them before reveal
    // ============================================================
    msg!("Encrypting 5 community cards...");
    let mut encrypted_community: [u128; 5] = [0; 5];
    for i in 0..5 {
        let encrypted = inco_cpi::encrypt_card_with_pda(
            &deck_state_info,
            deck_seeds,
            deck[i],
        )?;
        encrypted_community[i] = encrypted.unwrap();
        msg!("Community card {} encrypted: handle {}", i, encrypted_community[i]);
    }
    msg!("All 5 community cards encrypted!");

    // Helper to check if seat is occupied using bitmask
    let is_seat_occupied = |seat: u8| -> bool {
        (occupied_seats & (1 << seat)) != 0
    };

    // Find SB and BB positions (matching start_hand.rs logic)
    // In heads-up (2 players): dealer = SB, other player = BB
    // In 3+ players: SB is left of dealer, BB is left of SB
    let is_heads_up = current_players == 2;
    let (sb_pos, bb_pos) = if is_heads_up {
        // Heads-up: dealer is SB
        let sb = dealer_pos;
        let mut bb = (dealer_pos + 1) % max_players;
        while !is_seat_occupied(bb) && bb != dealer_pos {
            bb = (bb + 1) % max_players;
        }
        (sb, bb)
    } else {
        // Standard: SB is left of dealer
        let mut sb = (dealer_pos + 1) % max_players;
        while !is_seat_occupied(sb) {
            sb = (sb + 1) % max_players;
        }

        let mut bb = (sb + 1) % max_players;
        while !is_seat_occupied(bb) {
            bb = (bb + 1) % max_players;
        }
        (sb, bb)
    };

    msg!("Blind positions: SB=seat {}, BB=seat {} (heads_up={})", sb_pos, bb_pos, is_heads_up);

    // Reserve first 5 cards for community cards (indices 0-4)
    let mut deal_idx = 5usize;

    // Collect encryption results before updating deck_state
    let mut encrypted_cards: Vec<(usize, u128, u128)> = Vec::new();

    // Process each seat account
    for account_info in seat_accounts.iter() {
        // Security check 1: Verify account is owned by our program
        if account_info.owner != &program_id {
            continue;
        }

        let data = account_info.try_borrow_data()?;
        if data.len() >= 8 {
            let seat = PlayerSeat::try_deserialize(&mut &data[..])?;

            // Security check 2: Verify this seat belongs to this table
            if seat.table != table_key {
                drop(data);
                continue;
            }

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
            let player_pubkey = seat.player;
            drop(data);

            // Now borrow mutably to update
            let mut data = account_info.try_borrow_mut_data()?;
            let mut seat = PlayerSeat::try_deserialize(&mut &data[..])?;

            if has_chips && player_pubkey != Pubkey::default() {
                // Reset bet tracking for new hand
                seat.current_bet = 0;
                seat.total_bet_this_hand = 0;
                seat.has_acted = false;
                seat.cards_revealed = false;
                seat.revealed_card_1 = 255;
                seat.revealed_card_2 = 255;

                // Post blinds if applicable
                if seat_index == sb_pos {
                    let sb_amount = seat.place_bet(small_blind);
                    total_blinds_posted += sb_amount;
                    msg!("SB (seat {}) posts {}", seat_index, sb_amount);
                } else if seat_index == bb_pos {
                    let bb_amount = seat.place_bet(big_blind);
                    total_blinds_posted += bb_amount;
                    msg!("BB (seat {}) posts {}", seat_index, bb_amount);
                }

                // ENCRYPT cards using deck_state PDA as signer
                msg!("Encrypting cards for seat {}...", seat_index);
                let encrypted1 = inco_cpi::encrypt_card_with_pda(
                    &deck_state_info,
                    deck_seeds,
                    deck[deal_idx],
                )?;
                let encrypted2 = inco_cpi::encrypt_card_with_pda(
                    &deck_state_info,
                    deck_seeds,
                    deck[deal_idx + 1],
                )?;

                seat.hole_card_1 = encrypted1.unwrap();
                seat.hole_card_2 = encrypted2.unwrap();
                seat.status = PlayerStatus::Playing;

                // Store for later deck_state update
                encrypted_cards.push((deal_idx, encrypted1.unwrap(), encrypted2.unwrap()));

                deal_idx += 2;
                active_count += 1;
                msg!("Dealt encrypted cards to seat {}", seat_index);
            } else {
                // Player has no chips or empty seat
                active_players &= !(1 << seat_index);
                seat.status = PlayerStatus::Sitting;
            }

            seat.try_serialize(&mut *data)?;
        }
    }

    // Now update deck_state and hand_state
    let deck_state = &mut ctx.accounts.deck_state;
    let hand_state = &mut ctx.accounts.hand_state;

    // Store ENCRYPTED community cards (first 5 slots)
    // These can only be decrypted by authority when revealing flop/turn/river
    for i in 0..5 {
        deck_state.cards[i] = encrypted_community[i];
    }

    // Store encrypted hole cards
    for (idx, enc1, enc2) in encrypted_cards {
        deck_state.cards[idx] = enc1;
        deck_state.cards[idx + 1] = enc2;
    }

    // Update deck state
    deck_state.is_shuffled = true;
    deck_state.deal_index = deal_idx as u8;
    // NOTE: vrf_seed is NOT stored! The seed only existed in memory.

    // Update hand state
    hand_state.active_players = active_players;
    hand_state.active_count = active_count;
    // Use actual blinds posted (tracked during seat processing) instead of assuming both were posted
    hand_state.pot = hand_state.pot.saturating_add(total_blinds_posted);
    hand_state.community_cards = vec![255, 255, 255, 255, 255];
    hand_state.community_revealed = 0;

    // Verify we have enough players
    require!(
        active_count >= 2,
        HiddenHandError::NotEnoughPlayers
    );

    // Find first player to act
    // In heads-up: SB (dealer) acts first preflop
    // In 3+ players: UTG (after BB) acts first
    let action_pos = if is_heads_up {
        sb_pos
    } else {
        let mut pos = (bb_pos + 1) % max_players;
        for _ in 0..max_players {
            if (active_players & (1 << pos)) != 0 {
                break;
            }
            pos = (pos + 1) % max_players;
        }
        pos
    };
    hand_state.action_on = action_pos;

    // Advance to PreFlop
    hand_state.phase = GamePhase::PreFlop;
    hand_state.last_action_time = clock.unix_timestamp;
    hand_state.all_in_players = 0;

    msg!(
        "ATOMIC shuffle + encrypt complete! Pot: {}. Phase: PreFlop. Action on seat {}. Active: {}",
        hand_state.pot,
        hand_state.action_on,
        active_count
    );
    msg!("SECURITY: VRF seed was NEVER stored - only used in memory!");
    msg!("SECURITY: Community cards are ENCRYPTED - cannot be read until reveal!");
    msg!("IMPORTANT: Call grant_card_allowance for each player to enable hole card decryption");
    msg!("IMPORTANT: Authority must call reveal_community to show flop/turn/river");

    Ok(())
}
