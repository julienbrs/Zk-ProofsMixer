import {
  Field,
  SmartContract,
  State,
  method,
  state,
  MerkleMapWitness,
  AccountUpdate,
  Poseidon,
  Provable,
  UInt32,
  UInt64,
  Bool,
  MerkleMap,
} from 'snarkyjs';

import { DepositEvent } from './types';

// Constants
export const POOLS = {
  1: 100000,
  2: 500000,
  3: 1000000,
};
const NOT_DEPOSITED = Field(0);

// Error messages
const DEPOSIT_TYPE_ERROR_MSG = 'depositType must be 1, 2 or 3';
const DEPOSIT_WITNESS_ERROR_MSG = 'already deposited commitment';
const WITHDRAW_SPENT_ERROR_MSG = 'already withdrawn commitment';
const WITHDRAW_INVALID_NULLIFIER_ERROR_MSG = 'invalid nullifier';
const WITHDRAW_INVALID_COMMITMENT_ERROR_MSG = 'commitment not found';

export class ZkMixer extends SmartContract {
  @state(Field) commitmentsRoot = State<Field>();
  @state(Field) nullifierHashesRoot = State<Field>();

  events = {
    deposit: DepositEvent,
  };

  @method initState() {
    const emptyTreeRoot = new MerkleMap().getRoot();
    this.commitmentsRoot.set(emptyTreeRoot);
    this.nullifierHashesRoot.set(emptyTreeRoot);
  }

  /**
   * Deposit funds into the contract
   *
   * @remarks Commitment should be calculated as:
   * commitment = Poseidon.hash([nonce, nullifier, depositType, addressToWithdraw])
   * addressToWithdraw is 0 if the user wants to withdraw to the same address
   */
  @method deposit(
    commitment: Field,
    witness: MerkleMapWitness,
    depositType: Field
  ) {
    // make sure that the deposit type is between 1 and 3
    depositType.assertGreaterThanOrEqual(Field(1), DEPOSIT_TYPE_ERROR_MSG);
    depositType.assertLessThanOrEqual(Field(3), DEPOSIT_TYPE_ERROR_MSG);

    const initialRoot = this.commitmentsRoot.getAndAssertEquals();

    // Check that there are no other deposits with the same commitment
    const [rootBefore, key] = witness.computeRootAndKey(NOT_DEPOSITED);
    rootBefore.assertEquals(initialRoot, DEPOSIT_WITNESS_ERROR_MSG);
    key.assertEquals(commitment, DEPOSIT_WITNESS_ERROR_MSG);

    // compute the root after the deposit
    const [rootAfter] = witness.computeRootAndKey(depositType);

    // set the new root
    this.commitmentsRoot.set(rootAfter);

    // calculate the amount to deposit
    const whatTypeBool: Bool[] = [1, 2, 3].map((i) => depositType.equals(i));
    const amountToDepositField: Field = Provable.switch(whatTypeBool, Field, [
      Field(POOLS[1]),
      Field(POOLS[2]),
      Field(POOLS[3]),
    ]);
    const amountToDeposit: UInt64 = new UInt64(amountToDepositField);

    // send the funds to the contract
    const sendingAccount = AccountUpdate.createSigned(this.sender);
    sendingAccount.send({ to: this.address, amount: amountToDeposit });

    // emit event
    this.emitEvent('deposit', {
      commitment,
      depositType,
    });
  }

  /**
   * Withdraw funds from the contract
   *
   * @remarks Withdraw is valid if:
   * - the nullifier is valid not already spent
   * - the commitment is in the tree
   * - the deposit type is between 1 and 3
   * - the `addressToWithdraw" is 0 or matches the caller address
   */
  @method withdraw(
    nullifier: Field,
    nullifierWitness: MerkleMapWitness,
    commitmentWitness: MerkleMapWitness,
    nonce: UInt32,
    depositType: Field,
    specificAddressField: Field
  ) {
    // make sure that the deposit type is between 1 and 3
    depositType.assertGreaterThanOrEqual(Field(1), DEPOSIT_TYPE_ERROR_MSG);
    depositType.assertLessThanOrEqual(Field(3), DEPOSIT_TYPE_ERROR_MSG);

    const isFeatureEnabled: Bool = Provable.if(
      specificAddressField.equals(Field(0)), // true if the feature is disabled
      new Bool(false),
      new Bool(true)
    );
    const isAddressValid: Bool = Provable.if(
      isFeatureEnabled,
      specificAddressField.equals(this.sender.toFields()[0]),
      new Bool(true) // always true if amountToWithdraw is 0
    );
    // crash if the address is not valid
    isAddressValid.assertTrue();

    // check onchain states match
    this.commitmentsRoot.getAndAssertEquals();
    this.nullifierHashesRoot.getAndAssertEquals();

    // check that the nullifier is not already spent
    const notSpent = Field(0);
    const [oldRootNullifier, key] =
      nullifierWitness.computeRootAndKey(notSpent);
    oldRootNullifier.assertEquals(
      this.nullifierHashesRoot.get(),
      WITHDRAW_SPENT_ERROR_MSG
    );

    // check that the nullifier provided is the correct one
    const hashedNullifier = Poseidon.hash([nullifier]);
    key.assertEquals(hashedNullifier, WITHDRAW_INVALID_NULLIFIER_ERROR_MSG);

    const commitmentCalculated = Poseidon.hash(
      [nonce.toFields(), nullifier, depositType, specificAddressField].flat()
    );
    // check that the commitment provided is in the tree
    const [expectedRootCommitment, keyCommitment] =
      commitmentWitness.computeRootAndKey(depositType);

    expectedRootCommitment.assertEquals(
      this.commitmentsRoot.get(),
      WITHDRAW_INVALID_COMMITMENT_ERROR_MSG
    );
    keyCommitment.assertEquals(
      commitmentCalculated,
      WITHDRAW_INVALID_COMMITMENT_ERROR_MSG
    );

    // Consuming the commitment
    const spent = Field(1);
    const [newNullifierRoot, _] = nullifierWitness.computeRootAndKey(spent);
    this.nullifierHashesRoot.set(newNullifierRoot);

    // Calculate the amount to withdraw
    const whatTypeBool: Bool[] = [1, 2, 3].map((i) => depositType.equals(i));
    const amountToWithdrawField: Field = Provable.switch(whatTypeBool, Field, [
      Field(POOLS[1]),
      Field(POOLS[2]),
      Field(POOLS[3]),
    ]);
    const amountToWithdraw: UInt64 = new UInt64(amountToWithdrawField);

    // Withdraw funds
    this.send({ to: this.sender, amount: amountToWithdraw });
  }
}
