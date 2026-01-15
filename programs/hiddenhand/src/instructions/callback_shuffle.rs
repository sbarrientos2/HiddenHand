use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::{DeckState, GamePhase, HandState, Table};

/// VRF callback for card shuffling
/// This instruction is called by the VRF oracle with the randomness
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
}

/// VRF callback - receives 32 bytes of randomness and stores the seed
/// IMPORTANT: The actual shuffle happens on the Ephemeral Rollup in deal_cards_vrf
/// This ensures the card order is NEVER visible on the base layer
pub fn handler(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
    let deck_state = &mut ctx.accounts.deck_state;
    let hand_state = &mut ctx.accounts.hand_state;
    let table = &ctx.accounts.table;

    msg!(
        "VRF callback received for hand #{}",
        table.hand_number
    );
    msg!("Randomness (first 8 bytes): {:?}", &randomness[0..8]);

    // Store the VRF seed - DO NOT shuffle here!
    // The shuffle will happen on the ER after delegation to preserve privacy
    deck_state.vrf_seed = randomness;
    deck_state.seed_received = true;

    // DO NOT set is_shuffled = true here - that happens after shuffle on ER
    // DO NOT store cards here - they remain unshuffled (all zeros)

    // Initialize community cards placeholder
    hand_state.community_cards = vec![255, 255, 255, 255, 255];
    hand_state.community_revealed = 0;

    // Log the seed hash for verification (anyone can verify randomness is fair)
    let seed_hash = u64::from_le_bytes(randomness[24..32].try_into().unwrap());
    msg!("VRF seed stored. Verification hash: {}", seed_hash);
    msg!("Seed will be used to shuffle deck on ER after delegation.");

    // Transition to Dealing phase - deal_cards_vrf will shuffle and deal on ER
    hand_state.phase = GamePhase::Dealing;

    msg!(
        "VRF seed received for hand #{}. Ready for delegation and dealing.",
        table.hand_number
    );

    Ok(())
}
