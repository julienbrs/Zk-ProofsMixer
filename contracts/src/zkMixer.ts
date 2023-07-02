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
} from 'snarkyjs';

export class zkMixer extends SmartContract {
  @state(Field) commitmentRoot = State<Field>();
  @state(Field) nullifierRoot = State<Field>(); // It's not nullifier but hash(nullifier)

  @method initState(initialRoot: Field) {
    this.commitmentRoot.set(initialRoot);
    this.nullifierRoot.set(initialRoot);
  }

  deposit(amount: Field, commitment: Field, witness: MerkleMapWitness) {
    this.commitmentRoot.getAndAssertEquals();

    const notDeposited = Field(0);
    const [oldRoot, key] = witness.computeRootAndKey(notDeposited);
    oldRoot.assertEquals(this.commitmentRoot.get());

    key.assertEquals(commitment);

    // compute the root after incrementing
    const deposited = Field(1); // Find a way to put the amount also here
    const [newRoot, _] = witness.computeRootAndKey(deposited);

    this.commitmentRoot.set(newRoot);

    const sendingAccount = AccountUpdate.createSigned(this.sender);
    sendingAccount.send({ to: this.address, amount: 10 });
  }

  withdraw(
    amount: Field,
    nullifier: Field,
    nullifierWitness: MerkleMapWitness,
    commitmentWitness: MerkleMapWitness,
    nonce: Field
  ) {
    // check onchain state matches
    this.commitmentRoot.getAndAssertEquals();
    this.nullifierRoot.getAndAssertEquals();

    // check that the nullifier is not already spent
    const notSpent = Field(0);
    const [oldRootNullifier, key] =
      nullifierWitness.computeRootAndKey(notSpent);
    oldRootNullifier.assertEquals(this.nullifierRoot.get());

    const commitmentCalculated = Poseidon.hash([nonce, nullifier]);
    key.assertEquals(commitmentCalculated);

    // check that the commitment is in the tree
    const deposited = Field(1);
    const [oldRootCommitment, keyCommitment] =
      commitmentWitness.computeRootAndKey(deposited);

    oldRootCommitment.assertEquals(this.commitmentRoot.get());
    keyCommitment.assertEquals(commitmentCalculated);

    // Consuming the commitment
    const spent = Field(1);
    const [newNullifierRoot, _] = nullifierWitness.computeRootAndKey(spent);
    this.commitmentRoot.set(newNullifierRoot);

    this.send({ to: this.sender, amount: 10 });
  }
}
