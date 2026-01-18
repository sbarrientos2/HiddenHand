use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::constants::*;
use crate::error::HiddenHandError;
use crate::inco_cpi::INCO_PROGRAM_ID;
use crate::state::{DeckState, GamePhase, HandState, Table, TableStatus};

/// Request VRF randomness for card shuffling
/// This instruction initiates the shuffle process - the callback_shuffle
/// instruction will shuffle AND encrypt cards atomically when VRF responds.
///
/// IMPORTANT: Pass all player seat accounts as remaining_accounts!
/// The callback will use these to deal encrypted cards.
#[vrf]
#[derive(Accounts)]
pub struct RequestShuffle<'info> {
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

    /// CHECK: The VRF oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,

    /// The Inco Lightning program for encryption (passed to callback)
    /// CHECK: Verified by address constraint
    #[account(address = INCO_PROGRAM_ID)]
    pub inco_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: All player seat accounts for dealing
}

/// Request VRF randomness for shuffling
/// This is the first step of dealing - VRF will callback with randomness
/// and the callback will shuffle + encrypt cards atomically.
///
/// IMPORTANT: Pass all player seat accounts as remaining_accounts!
pub fn handler(ctx: Context<RequestShuffle>) -> Result<()> {
    let table = &ctx.accounts.table;
    let hand_state = &ctx.accounts.hand_state;
    let deck_state = &ctx.accounts.deck_state;

    // Validate we're in the right phase
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

    // Verify we have seat accounts in remaining_accounts
    require!(
        !ctx.remaining_accounts.is_empty(),
        HiddenHandError::NotEnoughPlayers
    );

    // Use table_id + hand_number as unique seed for this shuffle
    let mut client_seed = [0u8; 32];
    client_seed[0..8].copy_from_slice(&table.hand_number.to_le_bytes());
    client_seed[8..16].copy_from_slice(&Clock::get()?.slot.to_le_bytes());

    // Build callback accounts: table, hand_state, deck_state, inco_program, system_program, + all seats
    let mut callback_accounts = vec![
        SerializableAccountMeta {
            pubkey: ctx.accounts.table.key(),
            is_signer: false,
            is_writable: true,
        },
        SerializableAccountMeta {
            pubkey: ctx.accounts.hand_state.key(),
            is_signer: false,
            is_writable: true,
        },
        SerializableAccountMeta {
            pubkey: ctx.accounts.deck_state.key(),
            is_signer: false,
            is_writable: true,
        },
        SerializableAccountMeta {
            pubkey: ctx.accounts.inco_program.key(),
            is_signer: false,
            is_writable: false,
        },
        SerializableAccountMeta {
            pubkey: ctx.accounts.system_program.key(),
            is_signer: false,
            is_writable: false,
        },
    ];

    // Add all seat accounts from remaining_accounts
    for seat_account in ctx.remaining_accounts.iter() {
        callback_accounts.push(SerializableAccountMeta {
            pubkey: seat_account.key(),
            is_signer: false,
            is_writable: true,
        });
    }

    msg!(
        "Requesting VRF with {} callback accounts ({} seats)",
        callback_accounts.len(),
        ctx.remaining_accounts.len()
    );

    // Create VRF request - callback will shuffle + encrypt atomically
    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.authority.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::CallbackShuffle::DISCRIMINATOR.to_vec(),
        caller_seed: client_seed,
        accounts_metas: Some(callback_accounts),
        ..Default::default()
    });

    // Invoke VRF request
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.authority.to_account_info(), &ix)?;

    msg!(
        "VRF shuffle request sent for hand #{}. Callback will shuffle + encrypt atomically.",
        table.hand_number
    );
    Ok(())
}
