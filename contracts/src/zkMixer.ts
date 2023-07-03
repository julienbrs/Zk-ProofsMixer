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
    const amountToSend = Provable.switch(
      [1, 2, 3].map((i) => depositType.equals(i)),
      UInt64,
      [new UInt64(1), new UInt64(5), new UInt64(10)]
    );
    sendingAccount.send({ to: this.address, amount: amountToSend });
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

    // Withdraw funds
    const amountToWithdraw = Provable.switch(
      [1, 2, 3].map((i) => depositType.equals(i)),
      Field,
      [Field(1), Field(5), Field(10)]
    );

    this.send({ to: this.sender, amount: amountToWithdraw.toBigInt() });
  }
}
