//! Manual Inco Lightning CPI module
//!
//! This module constructs Inco CPI instructions manually to avoid
//! version conflicts between inco-lightning SDK and ephemeral-rollups-sdk.
//!
//! Key functions:
//! - `encrypt_card`: Encrypt a card value, returns encrypted handle
//! - `grant_allowance`: Grant decryption access to a player

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
};

/// Inco Lightning Program ID
pub const INCO_PROGRAM_ID: Pubkey = pubkey!("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");

/// Encrypted u128 handle (same as Inco's Euint128)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct EncryptedCard(pub u128);

impl EncryptedCard {
    pub fn unwrap(self) -> u128 {
        self.0
    }

    pub fn wrap(value: u128) -> Self {
        Self(value)
    }

    pub fn is_initialized(&self) -> bool {
        self.0 != 0
    }
}

/// Pre-computed sighash discriminators for Inco functions
/// These are SHA256("global:function_name")[0..8]
///
/// Computed via: hashlib.sha256(b'global:function_name').hexdigest()[:16]
mod discriminators {
    /// "global:as_euint128" -> 563d17adbb02f760
    pub const AS_EUINT128: [u8; 8] = [0x56, 0x3d, 0x17, 0xad, 0xbb, 0x02, 0xf7, 0x60];

    /// "global:allow" -> 3c678c416e6d93a4
    pub const ALLOW: [u8; 8] = [0x3c, 0x67, 0x8c, 0x41, 0x6e, 0x6d, 0x93, 0xa4];
}

/// Derive the allowance account PDA for a given handle and allowed address
/// Seeds: [handle_bytes, allowed_address] (NO "allowance" prefix!)
pub fn derive_allowance_account(handle: u128, allowed_address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            &handle.to_le_bytes(),
            allowed_address.as_ref(),
        ],
        &INCO_PROGRAM_ID,
    )
}

/// Encrypt a card value using Inco's as_euint128 function
///
/// # Arguments
/// * `signer` - The account info of the signer (must be writable and signer)
/// * `card_value` - The plaintext card value (0-51)
///
/// # Returns
/// * `EncryptedCard` - The encrypted handle
pub fn encrypt_card<'info>(
    signer: &AccountInfo<'info>,
    card_value: u8,
) -> Result<EncryptedCard> {
    // Build instruction data: discriminator + value as u128
    let mut data = Vec::with_capacity(8 + 16);
    data.extend_from_slice(&discriminators::AS_EUINT128);
    data.extend_from_slice(&(card_value as u128).to_le_bytes());

    let ix = Instruction {
        program_id: INCO_PROGRAM_ID,
        accounts: vec![AccountMeta::new(signer.key(), true)],
        data,
    };

    // Invoke the Inco program
    invoke(&ix, &[signer.clone()])?;

    // Get the return data (encrypted handle)
    let (_program_id, return_data) = anchor_lang::solana_program::program::get_return_data()
        .ok_or(ProgramError::InvalidAccountData)?;

    // Parse as u128 (Euint128 is just a wrapper around u128)
    let handle = u128::from_le_bytes(
        return_data
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );

    msg!("Card encrypted: {} -> handle {}", card_value, handle);
    Ok(EncryptedCard(handle))
}

/// Grant decryption access to a player for an encrypted card
///
/// # Arguments
/// * `signer` - The authority granting access (table authority)
/// * `allowance_account` - PDA derived from [allowance, handle, allowed_address]
/// * `allowed_address` - The player who should be able to decrypt
/// * `system_program` - System program for account creation
/// * `handle` - The encrypted card handle
///
/// # Note
/// The allowance_account must be passed as writable - Inco will create/update it
pub fn grant_allowance<'info>(
    signer: &AccountInfo<'info>,
    allowance_account: &AccountInfo<'info>,
    allowed_address: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    handle: u128,
) -> Result<()> {
    grant_allowance_with_pubkey(
        signer,
        allowance_account,
        allowed_address.key,
        system_program,
        handle,
        &[
            allowance_account.clone(),
            signer.clone(),
            allowed_address.clone(),
            system_program.clone(),
        ],
    )
}

/// Grant decryption access using just a Pubkey (no AccountInfo needed for player)
/// This is useful when we don't have the player's AccountInfo handy
pub fn grant_allowance_with_pubkey<'info>(
    signer: &AccountInfo<'info>,
    allowance_account: &AccountInfo<'info>,
    allowed_address: &Pubkey,
    system_program: &AccountInfo<'info>,
    handle: u128,
    account_infos: &[AccountInfo<'info>],
) -> Result<()> {
    // Build instruction data: discriminator + handle + true + allowed_address
    let mut data = Vec::with_capacity(8 + 16 + 1 + 32);
    data.extend_from_slice(&discriminators::ALLOW);
    data.extend_from_slice(&handle.to_le_bytes());
    data.push(1); // value = true (grant access)
    data.extend_from_slice(&allowed_address.to_bytes());

    let ix = Instruction {
        program_id: INCO_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(allowance_account.key(), false),
            AccountMeta::new(signer.key(), true),
            AccountMeta::new_readonly(*allowed_address, false),
            AccountMeta::new_readonly(system_program.key(), false),
        ],
        data,
    };

    invoke(&ix, account_infos)?;

    msg!(
        "Allowance granted: handle {} -> player {}",
        handle,
        allowed_address
    );
    Ok(())
}

/// Encrypt multiple cards in a batch (for efficiency)
/// Returns a vector of encrypted handles
pub fn encrypt_cards<'info>(
    signer: &AccountInfo<'info>,
    card_values: &[u8],
) -> Result<Vec<EncryptedCard>> {
    let mut handles = Vec::with_capacity(card_values.len());

    for &card in card_values {
        let handle = encrypt_card(signer, card)?;
        handles.push(handle);
    }

    Ok(handles)
}

/// Encrypt a card value using a PDA as the signer (for VRF callback)
///
/// This is used when we need to encrypt cards in a callback where
/// the original authority isn't available as a signer.
///
/// # Arguments
/// * `pda_account` - The PDA account that will sign via invoke_signed
/// * `pda_seeds` - The seeds used to derive the PDA (including bump)
/// * `card_value` - The plaintext card value (0-51)
///
/// # Returns
/// * `EncryptedCard` - The encrypted handle
pub fn encrypt_card_with_pda<'info>(
    pda_account: &AccountInfo<'info>,
    pda_seeds: &[&[u8]],
    card_value: u8,
) -> Result<EncryptedCard> {
    // Build instruction data: discriminator + value as u128
    let mut data = Vec::with_capacity(8 + 16);
    data.extend_from_slice(&discriminators::AS_EUINT128);
    data.extend_from_slice(&(card_value as u128).to_le_bytes());

    let ix = Instruction {
        program_id: INCO_PROGRAM_ID,
        accounts: vec![AccountMeta::new(pda_account.key(), true)],
        data,
    };

    // Invoke with PDA signer
    invoke_signed(&ix, &[pda_account.clone()], &[pda_seeds])?;

    // Get the return data (encrypted handle)
    let (_program_id, return_data) = anchor_lang::solana_program::program::get_return_data()
        .ok_or(ProgramError::InvalidAccountData)?;

    // Parse as u128 (Euint128 is just a wrapper around u128)
    let handle = u128::from_le_bytes(
        return_data
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );

    msg!("Card encrypted (PDA): {} -> handle {}", card_value, handle);
    Ok(EncryptedCard(handle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discriminators() {
        // Verify discriminator lengths
        assert_eq!(discriminators::AS_EUINT128.len(), 8);
        assert_eq!(discriminators::ALLOW.len(), 8);
    }

    #[test]
    fn test_encrypted_card() {
        let card = EncryptedCard::wrap(12345);
        assert_eq!(card.unwrap(), 12345);
        assert!(card.is_initialized());

        let empty = EncryptedCard::default();
        assert!(!empty.is_initialized());
    }
}
