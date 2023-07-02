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
}
