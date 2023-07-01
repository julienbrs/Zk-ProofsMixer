import {
  Field,
  SmartContract,
  state,
  State,
  method,
  Poseidon,
  PublicKey,
  MerkleMap,
  Proof,
  MerkleMapWitness,
} from 'snarkyjs';

export class zkAuthentification extends SmartContract {
  // use MerkleMap to link a user public key to his last zkSnark proof
  @state(Field) mapRoot = State<Field>();

  @method initAccount(initRoot: Field) {
    this.mapRoot.set(initRoot);
  }

  @method updateAccount(
    keyWitness: MerkleMapWitness,
    keyToChange: Field,
    valueBefore: Field,
    increment: Field
  ) {
    const initialRoot = this.mapRoot.get();
    this.mapRoot.assertEquals(initialRoot);

    increment.assertLessThan(Field(1000));

    // Check the initial state
    const [rootBefore, keyBefore] = keyWitness.computeRootAndKey(valueBefore);
    rootBefore.assertEquals(initialRoot);

    keyBefore.assertEquals(keyToChange);

    // compute the root after incrementing
    const [rootAfter, _] = keyWitness.computeRootAndKey(
      valueBefore.add(increment)
    );

    // set the new root
    this.mapRoot.set(rootAfter);
  }
}
