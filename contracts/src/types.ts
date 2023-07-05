import {
  Field,
  UInt32,
  PublicKey,
  PrivateKey,
  MerkleMap,
  Struct,
} from 'snarkyjs';

/**
 * Represents a deposit note.
 * It can be used to withdraw funds from the mixer.
 */
export interface DepositNote {
  nonce: UInt32;
  commitment: Field;
  nullifier: Field;
  depositType: Field;
  addressToWithdrawField: Field;
}

// Represents a key pair to sign transactions.
export type KeyPair = {
  publicKey: PublicKey; // The public key of the key pair.
  privateKey: PrivateKey; // The private key of the key pair.
};

/**
 * Represents the local state of the mixer contract.
 */
export type LocalState = {
  localCommitmentsMap: MerkleMap;
  localNullifierHashedMap: MerkleMap;
};

export class DepositEvent extends Struct({
  commitment: Field,
  depositType: Field,
}) {}
