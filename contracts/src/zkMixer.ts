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
}
