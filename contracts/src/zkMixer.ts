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
  @state(Field) mapRoot = State<Field>();

  @method initState(initialRoot: Field) {
    this.mapRoot.set(initialRoot);
  }

  deposit(amount: Field, commitment: Field, witness: MerkleMapWitness) {
    this.mapRoot.getAndAssertEquals();

    const notDeposited = Field(0);
    const [oldRoot, key] = witness.computeRootAndKey(notDeposited);
    oldRoot.assertEquals(this.mapRoot.get());

    key.assertEquals(commitment);

    // compute the root after incrementing
    const deposited = Field(1); // Find a way to put the amount also here
    const [newRoot, _] = witness.computeRootAndKey(deposited);

    this.mapRoot.set(newRoot);

    // How to send the amount to the user?
  }

  withdraw(
    amount: Field,
    nullifier: Field,
    nullifierWitness: MerkleMapWitness,
    commitmentWitness: MerkleMapWitness
  ) {
    // check onchain state matches
    this.mapRoot.getAndAssertEquals();

    // check that the nullifier is not already spent
    const notSpent = Field(0);
    const [oldRootNullifier, key] =
      nullifierWitness.computeRootAndKey(notSpent);
    oldRootNullifier.assertEquals(this.mapRoot.get());

    const nullifierHash = Poseidon.hash(nullifier.toFields());
    key.assertEquals(nullifierHash);

    // check that the commitment is in the tree
    const deposited = Field(1);
    const [oldRootCommitment, keyCommitment] =
      commitmentWitness.computeRootAndKey(deposited);

    oldRootCommitment.assertEquals(this.mapRoot.get());
    keyCommitment.assertEquals(nullifierHash);

    // Consuming the commitment
    const spent = Field(1);
    const [newNullifierRoot, _] = nullifierWitness.computeRootAndKey(spent);
    this.mapRoot.set(newNullifierRoot);

    // How to send the amount to the user? using account updates?
  }
}
