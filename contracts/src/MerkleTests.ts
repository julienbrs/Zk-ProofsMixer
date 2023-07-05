import {
  Field,
  SmartContract,
  State,
  method,
  state,
  MerkleMapWitness,
  AccountUpdate,
  PrivateKey,
  MerkleMap,
  Mina,
  Struct,
} from 'snarkyjs';

class SetEvent extends Struct({
  key: Field,
  value: Field,
}) {}

export class MerkleTest extends SmartContract {
  @state(Field) merkleRoot = State<Field>();

  events = {
    set: SetEvent,
  };

  @method initState() {
    this.merkleRoot.set(new MerkleMap().getRoot());
  }

  @method set(keyWitness: MerkleMapWitness, key: Field, value: Field) {
    // can't set value to 0 as it's the value for "unset"
    value.assertNotEquals(Field(0));

    const initialRoot = this.merkleRoot.getAndAssertEquals();

    // check the initial state matches what we expect
    const [rootBefore, keyBefore] = keyWitness.computeRootAndKey(Field(0));
    rootBefore.assertEquals(initialRoot);
    keyBefore.assertEquals(key);

    // compute the root after incrementing
    const [rootAfter, _] = keyWitness.computeRootAndKey(value);

    // set the new root
    this.merkleRoot.set(rootAfter);

    // emit event
    this.emitEvent('set', {
      key,
      value,
    });
  }
}

const main = async () => {
  console.log('Deploying...');
  const Local = Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(Local);

  const deployer = Local.testAccounts[0].privateKey;
  const deployerPub = deployer.toPublicKey();

  const appKey = PrivateKey.random();
  const appPub = appKey.toPublicKey();
  const app = new MerkleTest(appPub);

  const deployTx = await Mina.transaction(deployerPub, () => {
    AccountUpdate.fundNewAccount(deployerPub);
    app.deploy();
  });
  await deployTx.prove();
  await deployTx.sign([deployer, appKey]).send();

  const initTx = await Mina.transaction(deployerPub, () => {
    app.initState();
  });
  await initTx.prove();
  await initTx.sign([deployer]).send();

  console.log('Deployed at', app.address.toBase58().toString());
  console.log('merkleRoot:', app.merkleRoot.get().toString());

  const sender = Local.testAccounts[1].privateKey;
  const senderPub = sender.toPublicKey();

  // --------

  let localMK = new MerkleMap();

  const sendSetTx = async (mk: MerkleMap, key: Field, value: Field) => {
    const setTx = await Mina.transaction(senderPub, () => {
      app.set(mk.getWitness(key), key, value);
    });
    await setTx.prove();
    await setTx.sign([sender]).send();

    mk.set(key, value);
    console.log(`\nSet ${key} -> ${value}`);
    console.log('merkleRoot:', app.merkleRoot.get().toString());
    console.log('localRoot:', mk.getRoot().toString());
  };

  await sendSetTx(localMK, Field(1), Field(1));
  await sendSetTx(localMK, Field(2), Field(2));
  await sendSetTx(localMK, Field(3), Field(3));

  // Now imagine we don't have the current map
  localMK = new MerkleMap();
  console.log('\nResetting local map...');
  console.log('merkleRoot:', app.merkleRoot.get().toString());
  console.log('localRoot:', localMK.getRoot().toString());

  // But we do have the root

  // How can we create a witness for a specific key?
  // We don't want to rely on off-chain storage, so let's use events

  // we can use the event to reconstruct our tree
  const fetchLatestTree = async (): Promise<MerkleMap> => {
    const tree = new MerkleMap();
    (await app.fetchEvents())
      .filter((e) => e.type === 'set')
      .forEach((e) => {
        const event = e.event.data as unknown as SetEvent;
        console.log(
          'fetched set:',
          event.key.toString(),
          '->',
          event.value.toString()
        );
        tree.set(event.key, event.value);
      });
    return tree;
  };

  console.log('\nReconstructing tree from events...');
  localMK = await fetchLatestTree();

  console.log('\nAfter reconstruction:');
  console.log('merkleRoot:', app.merkleRoot.get().toString());
  console.log('localRoot:', localMK.getRoot().toString());

  // Now we can create a witness for a specific key
  await sendSetTx(localMK, Field(4), Field(4));
};

main().then(() => process.exit(0));
