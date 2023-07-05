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
  Permissions,
} from 'snarkyjs';

export class ZkMixer extends SmartContract {
  @state(Field) commitmentsRoot = State<Field>();
  @state(Field) nullifierHashesRoot = State<Field>();

  init() {
    super.init();
    this.account.permissions.set({
      ...Permissions.default(),
    });
  }

  @method initState(initialCommitmentRoot: Field, initialNullifierRoot: Field) {
    this.commitmentsRoot.set(initialCommitmentRoot);
    this.nullifierHashesRoot.set(initialNullifierRoot);
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
    depositType.assertGreaterThanOrEqual(Field(1));
    depositType.assertLessThanOrEqual(Field(3));

    const initialRoot = this.commitmentsRoot.get();
    this.commitmentsRoot.assertEquals(initialRoot);

    // check the initial state matches what we expect
    const notDeposited = Field(0); // 0 means not deposited
    const [rootBefore, key] = witness.computeRootAndKey(notDeposited);
    rootBefore.assertEquals(initialRoot); // check the root matches

    key.assertEquals(commitment); // check the commitment is in the tree

    // compute the root after the deposit
    const [rootAfter] = witness.computeRootAndKey(depositType);

    // set the new root
    this.commitmentsRoot.set(rootAfter);

    // calculate the amount to deposit
    const whatTypeBool: Bool[] = [1, 2, 3].map((i) => depositType.equals(i));
    const amountToDepositField: Field = Provable.switch(whatTypeBool, Field, [
      Field(100000),
      Field(500000),
      Field(1000000),
    ]);
    const amountToDeposit: UInt64 = new UInt64(amountToDepositField);

    // send the funds to the contract
    const sendingAccount = AccountUpdate.createSigned(this.sender);
    sendingAccount.send({ to: this.address, amount: amountToDeposit });
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
    depositType.assertGreaterThanOrEqual(Field(1));
    depositType.assertLessThanOrEqual(Field(3));

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
    oldRootNullifier.assertEquals(this.nullifierHashesRoot.get());

    // check that the nullifier provided is the correct one
    const hashedNullifier = Poseidon.hash([nullifier]);
    key.assertEquals(hashedNullifier);

    const commitmentCalculated = Poseidon.hash(
      [nonce.toFields(), nullifier, depositType, specificAddressField].flat()
    );
    // check that the commitment provided is in the tree
    const [expectedRootCommitment, keyCommitment] =
      commitmentWitness.computeRootAndKey(depositType);

    expectedRootCommitment.assertEquals(this.commitmentsRoot.get());
    keyCommitment.assertEquals(commitmentCalculated);

    // Consuming the commitment
    const spent = Field(1);
    const [newNullifierRoot, _] = nullifierWitness.computeRootAndKey(spent);
    this.nullifierHashesRoot.set(newNullifierRoot);

    // Calculate the amount to withdraw
    const whatTypeBool: Bool[] = [1, 2, 3].map((i) => depositType.equals(i));
    const amountToWithdrawField: Field = Provable.switch(whatTypeBool, Field, [
      Field(100000),
      Field(500000),
      Field(1000000),
    ]);
    const amountToWithdraw: UInt64 = new UInt64(amountToWithdrawField);

    console.log('depositType', depositType);
    console.log('amountToWithdraw', amountToWithdrawField);

    // Withdraw funds
    this.send({ to: this.sender, amount: amountToWithdraw });
  }
}
