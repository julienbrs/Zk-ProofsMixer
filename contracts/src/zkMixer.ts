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
} from 'snarkyjs';

export class ZkMixer extends SmartContract {
  @state(Field) commitmentRoot = State<Field>();
  @state(Field) nullifierRoot = State<Field>(); // It's not nullifier but hash(nullifier)

  @method initState(initialCommitmentRoot: Field, initialNullifierRoot: Field) {
    this.commitmentRoot.set(initialCommitmentRoot);
    this.nullifierRoot.set(initialNullifierRoot);
  }

  deposit(commitment: Field, witness: MerkleMapWitness, depositType: Field) {
    depositType.assertGreaterThanOrEqual(Field(1));
    depositType.assertLessThanOrEqual(Field(3));
    this.commitmentRoot.getAndAssertEquals();

    const notDeposited = Field(0);
    const [oldRoot, key] = witness.computeRootAndKey(notDeposited);
    oldRoot.assertEquals(this.commitmentRoot.get());

    key.assertEquals(commitment);

    // compute the root after incrementing
    const [newRoot, _] = witness.computeRootAndKey(depositType);

    this.commitmentRoot.set(newRoot);

    const sendingAccount = AccountUpdate.createSigned(this.sender);

    const amountToSend = Provable.switch(
      [1, 2, 3].map((i) => depositType.equals(i)),
      Field,
      [Field(1), Field(5), Field(10)]
    );

    sendingAccount.send({ to: this.address, amount: amountToSend.toBigInt() });
  }

  withdraw(
    nullifier: Field,
    nullifierWitness: MerkleMapWitness,
    commitmentWitness: MerkleMapWitness,
    nonce: Field[],
    depositType: Field
  ) {
    depositType.assertGreaterThanOrEqual(Field(1));
    depositType.assertLessThanOrEqual(Field(3));

    // check onchain state matches
    this.commitmentRoot.getAndAssertEquals();
    this.nullifierRoot.getAndAssertEquals();

    // check that the nullifier is not already spent
    const notSpent = Field(0);
    const [oldRootNullifier, key] =
      nullifierWitness.computeRootAndKey(notSpent);
    oldRootNullifier.assertEquals(this.nullifierRoot.get());

    const commitmentCalculated = Poseidon.hash(
      [nonce, nullifier, depositType].flat()
    );
    key.assertEquals(commitmentCalculated);

    // check that the commitment is in the tree
    const [expectedRootCommitment, keyCommitment] =
      commitmentWitness.computeRootAndKey(depositType);

    expectedRootCommitment.assertEquals(this.commitmentRoot.get());
    keyCommitment.assertEquals(commitmentCalculated);

    // Consuming the commitment
    const spent = Field(1);
    const [newNullifierRoot, _] = nullifierWitness.computeRootAndKey(spent);
    this.commitmentRoot.set(newNullifierRoot);

    // Withdraw funds
    const amountToWithdraw = Provable.switch(
      [1, 2, 3].map((i) => depositType.equals(i)),
      Field,
      [Field(1), Field(5), Field(10)]
    );

    this.send({ to: this.sender, amount: amountToWithdraw.toBigInt() });
  }
}
