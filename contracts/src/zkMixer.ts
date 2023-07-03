import {
  Field,
  SmartContract,
  State,
  method,
  state,
  MerkleMapWitness,
  AccountUpdate,
  UInt64,
  Poseidon,
  Circuit,
  Int64,
  Bool,
} from 'snarkyjs';

export class zkMixer extends SmartContract {
  @state(Field) commitmentRoot = State<Field>();
  @state(Field) nullifierRoot = State<Field>(); // It's not nullifier but hash(nullifier)

  @method initState(initialRoot: Field) {
    this.commitmentRoot.set(initialRoot);
    this.nullifierRoot.set(initialRoot);
  }

  deposit(amountToSend: bigint, commitment: Field, witness: MerkleMapWitness) {
    this.commitmentRoot.getAndAssertEquals();

    const notDeposited = Field(0);
    const [oldRoot, key] = witness.computeRootAndKey(notDeposited);
    oldRoot.assertEquals(this.commitmentRoot.get());

    key.assertEquals(commitment);

    // compute the root after incrementing
    const deposited = Field(amountToSend); //  1 2 or 3
    const [newRoot, _] = witness.computeRootAndKey(deposited);

    this.commitmentRoot.set(newRoot);

    const sendingAccount = AccountUpdate.createSigned(this.sender);
    sendingAccount.send({ to: this.address, amount: amountToSend }); // TODO: update to amount
  }

  withdraw(
    amountToWithdraw: bigint,
    nullifier: Field,
    nullifierWitness: MerkleMapWitness,
    commitmentWitness: MerkleMapWitness,
    nonce: Field
  ) {
    // check onchain state matches
    this.commitmentRoot.getAndAssertEquals();
    this.nullifierRoot.getAndAssertEquals();

    /* Can we do that or we need to use a circuit? */
    // const amountField = Field(amountToWithdraw);
    // const isOne = amountField.equals(Field(1));
    // const isTwo = amountField.equals(Field(2));
    // const isThree = amountField.equals(Field(3));

    // const isValidAmount = isOne.or(isTwo).or(isThree);
    // isValidAmount.assertTrue();

    // check that the nullifier is not already spent
    const notSpent = Field(0);
    const [oldRootNullifier, key] =
      nullifierWitness.computeRootAndKey(notSpent);
    oldRootNullifier.assertEquals(this.nullifierRoot.get());

    const commitmentCalculated = Poseidon.hash([nonce, nullifier]);
    key.assertEquals(commitmentCalculated);

    // check that the commitment is in the tree
    const deposited = Field(amountToWithdraw);
    const [expectedRootCommitment, keyCommitment] =
      commitmentWitness.computeRootAndKey(deposited);

    expectedRootCommitment.assertEquals(this.commitmentRoot.get());
    keyCommitment.assertEquals(commitmentCalculated);

    // Consuming the commitment
    const spent = Field(1);
    const [newNullifierRoot, _] = nullifierWitness.computeRootAndKey(spent);
    this.commitmentRoot.set(newNullifierRoot);

    this.send({ to: this.sender, amount: amountToWithdraw });
  }
}
