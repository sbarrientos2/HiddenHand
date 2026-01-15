#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::instruction::{Instruction, AccountMeta};
use anchor_lang::solana_program::system_program;
use inco_lightning::cpi::accounts::Operation;
use inco_lightning::cpi::e_rand;
use inco_lightning::types::Euint128;

declare_id!("J6gLdXApGmMLSbW33zihUa7RCfVtpAbhnqrZiFAAZLKg");

/// Seed for the test state PDA
pub const TEST_STATE_SEED: &[u8] = b"test_state_v3";

/// MagicBlock Delegation Program ID
pub const DELEGATION_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// Buffer Program ID (needed for delegation)
pub const BUFFER_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!("BUFFERjmBMVLaSbkLQBMSSH1M9LRP4T4oeHU1GrUBuuY");

#[program]
pub mod inco_er_test {
    use super::*;

    /// Initialize the test state account
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.test_state;
        state.authority = ctx.accounts.authority.key();
        state.test_value = 0;
        state.inco_handle = Euint128::default();
        state.test_completed = false;
        state.bump = ctx.bumps.test_state;

        msg!("Test state initialized");
        Ok(())
    }

    /// Delegate the test state to MagicBlock ER
    /// Uses raw CPI to avoid SDK version conflicts
    pub fn delegate_to_er(ctx: Context<DelegateToEr>) -> Result<()> {
        msg!("Delegating test state to Ephemeral Rollup...");

        let test_state_key = ctx.accounts.test_state.key();

        // Derive the required PDAs
        // delegateBuffer = PDA ["buffer", delegatedAccount] from owner program
        let (delegate_buffer, _) = Pubkey::find_program_address(
            &[b"buffer", test_state_key.as_ref()],
            &crate::ID
        );

        // delegationRecord = PDA ["delegation", delegatedAccount] from delegation program
        let (delegation_record, _) = Pubkey::find_program_address(
            &[b"delegation", test_state_key.as_ref()],
            &DELEGATION_PROGRAM_ID
        );

        // delegationMetadata = PDA ["delegation-metadata", delegatedAccount] from delegation program
        let (delegation_metadata, _) = Pubkey::find_program_address(
            &[b"delegation-metadata", test_state_key.as_ref()],
            &DELEGATION_PROGRAM_ID
        );

        msg!("PDAs derived:");
        msg!("  delegate_buffer: {}", delegate_buffer);
        msg!("  delegation_record: {}", delegation_record);
        msg!("  delegation_metadata: {}", delegation_metadata);

        // Build instruction data according to MagicBlock SDK format:
        // - 8 bytes: discriminator (all zeros)
        // - 4 bytes: commit_frequency_ms (u32, 0xFFFFFFFF for default)
        // - 4 bytes: seeds count
        // - For each seed: 4 bytes length + seed bytes
        // - 1 byte: validator option (0 = None)

        let authority_key = ctx.accounts.payer.key();
        let seeds: &[&[u8]] = &[TEST_STATE_SEED, authority_key.as_ref()];

        let mut data = Vec::with_capacity(128);
        data.extend_from_slice(&[0u8; 8]); // discriminator
        data.extend_from_slice(&0xFFFFFFFFu32.to_le_bytes()); // commit_frequency_ms

        // Write seeds
        data.extend_from_slice(&(seeds.len() as u32).to_le_bytes()); // seeds count
        for seed in seeds {
            data.extend_from_slice(&(seed.len() as u32).to_le_bytes()); // seed length
            data.extend_from_slice(seed); // seed bytes
        }

        data.push(0u8); // validator = None

        msg!("Instruction data length: {}", data.len());

        // Build the instruction with all required accounts
        let ix = Instruction {
            program_id: DELEGATION_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.payer.key(), true),          // payer (signer)
                AccountMeta::new(test_state_key, true),                    // delegatedAccount (signer!)
                AccountMeta::new_readonly(crate::ID, false),               // ownerProgram
                AccountMeta::new(delegate_buffer, false),                  // delegateBuffer
                AccountMeta::new(delegation_record, false),                // delegationRecord
                AccountMeta::new(delegation_metadata, false),              // delegationMetadata
                AccountMeta::new_readonly(system_program::ID, false),      // systemProgram
            ],
            data,
        };

        // Use invoke_signed because test_state is a PDA that needs to sign
        let signer_seeds: &[&[&[u8]]] = &[&[
            TEST_STATE_SEED,
            authority_key.as_ref(),
            &[ctx.accounts.test_state.bump],
        ]];

        invoke_signed(
            &ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.test_state.to_account_info(),
                ctx.accounts.owner_program.to_account_info(),
                ctx.accounts.delegate_buffer.to_account_info(),
                ctx.accounts.delegation_record.to_account_info(),
                ctx.accounts.delegation_metadata.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        msg!("Delegation successful!");
        Ok(())
    }

    /// Test Inco CPI - call e_rand and store the result
    /// This tests if we can CPI to Inco from our program
    /// Call this AFTER delegating to test ER -> Inco CPI
    pub fn test_inco_cpi(ctx: Context<TestIncoCpi>) -> Result<()> {
        msg!("===========================================");
        msg!("TESTING: Inco e_rand CPI");
        msg!("===========================================");

        let state = &mut ctx.accounts.test_state;

        // Store a test value to prove we're running
        state.test_value = state.test_value.saturating_add(1);
        msg!("Incremented test_value to: {}", state.test_value);

        // Attempt CPI to Inco Lightning's e_rand
        msg!("Attempting CPI to Inco e_rand...");

        // Create the CPI context for Inco
        let cpi_accounts = Operation {
            signer: ctx.accounts.authority.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(
            ctx.accounts.inco_program.to_account_info(),
            cpi_accounts,
        );

        // Call e_rand - this is the moment of truth!
        // scalar_byte = 0 means the operation is on encrypted values
        let handle = e_rand(cpi_ctx, 0)?;

        msg!("SUCCESS! Got Inco handle: {:?}", handle);

        // Store the result
        state.inco_handle = handle;
        state.test_completed = true;

        msg!("===========================================");
        msg!("TEST PASSED: Inco CPI works!");
        msg!("Handle value: {}", handle.0);
        msg!("===========================================");

        Ok(())
    }

    /// Simple test that doesn't use Inco - baseline for ER testing
    pub fn test_baseline(ctx: Context<TestBaseline>) -> Result<()> {
        let state = &mut ctx.accounts.test_state;
        state.test_value = state.test_value.saturating_add(100);
        msg!("Baseline test: Incremented test_value to {}", state.test_value);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = TestState::SIZE,
        seeds = [TEST_STATE_SEED, authority.key().as_ref()],
        bump
    )]
    pub test_state: Account<'info, TestState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateToEr<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [TEST_STATE_SEED, payer.key().as_ref()],
        bump = test_state.bump,
    )]
    pub test_state: Account<'info, TestState>,

    /// CHECK: MagicBlock delegation program
    #[account(address = DELEGATION_PROGRAM_ID)]
    pub delegation_program: UncheckedAccount<'info>,

    /// CHECK: Our program (owner of the delegated account)
    #[account(executable, address = crate::ID)]
    pub owner_program: UncheckedAccount<'info>,

    /// CHECK: Delegate buffer PDA (derived from test_state and owner program)
    #[account(mut)]
    pub delegate_buffer: UncheckedAccount<'info>,

    /// CHECK: Delegation record PDA (derived from delegatedAccount)
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,

    /// CHECK: Delegation metadata PDA (derived from delegatedAccount)
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TestIncoCpi<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [TEST_STATE_SEED, authority.key().as_ref()],
        bump = test_state.bump,
    )]
    pub test_state: Account<'info, TestState>,

    /// CHECK: The Inco Lightning program
    #[account(address = inco_lightning::ID)]
    pub inco_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TestBaseline<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [TEST_STATE_SEED, authority.key().as_ref()],
        bump = test_state.bump,
    )]
    pub test_state: Account<'info, TestState>,
}

#[account]
pub struct TestState {
    /// Authority who created this test
    pub authority: Pubkey,
    /// Simple test value to verify state changes work
    pub test_value: u64,
    /// Inco encrypted handle (if CPI works)
    pub inco_handle: Euint128,
    /// Whether the Inco test completed successfully
    pub test_completed: bool,
    /// PDA bump
    pub bump: u8,
}

impl TestState {
    pub const SIZE: usize = 8 +  // discriminator
        32 +  // authority
        8 +   // test_value
        16 +  // inco_handle (Euint128 is u128 = 16 bytes)
        1 +   // test_completed
        1;    // bump
}
