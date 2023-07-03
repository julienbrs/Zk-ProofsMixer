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
  Int64,
  Bool,
  Circuit,
} from 'snarkyjs';

export class ZkMixer extends SmartContract {
  @state(Field) commitmentsRoot = State<Field>();
  @state(Field) nullifierHashesRoot = State<Field>(); // It's not nullifier but hash(nullifier)

  @method initState(initialCommitmentRoot: Field, initialNullifierRoot: Field) {
    this.commitmentsRoot.set(initialCommitmentRoot);
    this.nullifierHashesRoot.set(initialNullifierRoot);
  }

  @method deposit(
    commitment: Field,
    witness: MerkleMapWitness,
    depositType: Field
  ) {
    depositType.assertGreaterThanOrEqual(Field(1));
    depositType.assertLessThanOrEqual(Field(3));

    const initialRoot = this.commitmentsRoot.get();
    this.commitmentsRoot.assertEquals(initialRoot);

    // check the initial state matches what we expect
    const notDeposited = Field(0);
    const [rootBefore, key] = witness.computeRootAndKey(notDeposited);
    rootBefore.assertEquals(initialRoot);

    key.assertEquals(commitment);

    // compute the root after incrementing
    const [rootAfter, _] = witness.computeRootAndKey(depositType);

    // set the new root
    this.commitmentsRoot.set(rootAfter);

    const sendingAccount = AccountUpdate.createSigned(this.sender);

    // calculate the amount to deposit
    const whatTypeBool: Bool[] = [1, 2, 3].map((i) => depositType.equals(i));
    const amountToDepositField: Field = Provable.switch(whatTypeBool, Field, [
      Field(1),
      Field(5),
      Field(10),
    ]);
    const amountToDeposit: UInt64 = new UInt64(amountToDepositField);

    // send the funds to the contract
    sendingAccount.send({ to: this.address, amount: amountToDeposit });
  }

  @method withdraw(
    nullifier: Field,
    nullifierWitness: MerkleMapWitness,
    commitmentWitness: MerkleMapWitness,
    nonce: UInt32,
    depositType: Field
  ) {
    depositType.assertGreaterThanOrEqual(Field(1));
    depositType.assertLessThanOrEqual(Field(3));

    // check onchain state matches
    this.commitmentsRoot.getAndAssertEquals();
    this.nullifierHashesRoot.getAndAssertEquals();

    // check that the nullifier is not already spent
    const notSpent = Field(0);
    const [oldRootNullifier, key] =
      nullifierWitness.computeRootAndKey(notSpent);
    oldRootNullifier.assertEquals(this.nullifierHashesRoot.get());

    const commitmentCalculated = Poseidon.hash(
      [nonce.toFields(), nullifier, depositType].flat()
    );
    key.assertEquals(commitmentCalculated);

    // check that the commitment is in the tree
    const [expectedRootCommitment, keyCommitment] =
      commitmentWitness.computeRootAndKey(depositType);

    expectedRootCommitment.assertEquals(this.commitmentsRoot.get());
    keyCommitment.assertEquals(commitmentCalculated);

    // Consuming the commitment
    const spent = Field(1);
    const [newNullifierRoot, _] = nullifierWitness.computeRootAndKey(spent);
    this.commitmentsRoot.set(newNullifierRoot);

    // Calculate the amount to withdraw
    const whatTypeBool: Bool[] = [1, 2, 3].map((i) => depositType.equals(i));
    const amountToWithdrawField: Field = Provable.switch(whatTypeBool, Field, [
      Field(1),
      Field(5),
      Field(10),
    ]);
    const amountToWithdraw: UInt64 = new UInt64(amountToWithdrawField);

    // Withdraw funds
    this.send({ to: this.sender, amount: amountToWithdraw });
  }
}
