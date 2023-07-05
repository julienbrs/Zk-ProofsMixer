import { Field, MerkleMap, Mina, PrivateKey } from 'snarkyjs';

import { DepositNote, KeyPair, LocalState } from './types.js';
import { ZkMixer } from './zkMixer.js';
import {
  deployAndInit,
  depositWrapper,
  withdrawWrapper,
} from './utils/index.js';

console.log(`
                                                                             
                                                                             
███████╗██╗  ██╗███╗   ███╗██╗██╗  ██╗███████╗██████╗ 
╚══███╔╝██║ ██╔╝████╗ ████║██║╚██╗██╔╝██╔════╝██╔══██╗
  ███╔╝ █████╔╝ ██╔████╔██║██║ ╚███╔╝ █████╗  ██████╔╝
 ███╔╝  ██╔═██╗ ██║╚██╔╝██║██║ ██╔██╗ ██╔══╝  ██╔══██╗
███████╗██║  ██╗██║ ╚═╝ ██║██║██╔╝ ██╗███████╗██║  ██║
╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
                                                                             
                                                      
                                                      `);

// --------------------------------------
// State and types setup
// --------------------------------------

const enable_logging = false;

let app: ZkMixer, keys: KeyPair, state: LocalState, deployer: KeyPair;

state = {
  localCommitmentsMap: new MerkleMap(),
  localNullifierHashedMap: new MerkleMap(),
};

// --------------------------------------
// Mina blockchain setup
// --------------------------------------

const Local = Mina.LocalBlockchain({ proofsEnabled: false });
Mina.setActiveInstance(Local);
deployer = {
  publicKey: Local.testAccounts[0].publicKey,
  privateKey: Local.testAccounts[0].privateKey,
};

let generatedPrivateKey = PrivateKey.random();
keys = {
  publicKey: generatedPrivateKey.toPublicKey(),
  privateKey: generatedPrivateKey,
};
app = new ZkMixer(keys.publicKey);

await deployAndInit(app, keys.privateKey, deployer);

console.log('zkMixer deployed and initialized');

class User {
  keys: KeyPair;

  constructor(index: number) {
    this.keys = Local.testAccounts[index];
  }

  balance(): bigint {
    return Mina.getAccount(this.keys.publicKey).balance.toBigInt();
  }
}

// --------------------------------------
// Helpers for deposit, withdraw and logs
// --------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const log = (...args: any[]) => {
  if (enable_logging) {
    console.log('[DEBUG]', ...args);
  }
};

async function deposit(
  depositType: Field,
  caller: User,
  addressToWithdraw: User | null = null
): Promise<DepositNote> {
  return await depositWrapper(
    app,
    state,
    depositType,
    caller.keys,
    addressToWithdraw?.keys?.publicKey.toFields()[0],
    log
  );
}

async function withdraw(caller: User, note: DepositNote) {
  return await withdrawWrapper(app, state, caller.keys, note, log);
}

// --------------------------------------
// Real use case scenario
// --------------------------------------

let alice = new User(1);
let bob = new User(2);
let oscar = new User(3);
let eve = new User(4);

/* Common usage: Alice deposits, Bob withdraws */

console.log(
  '\n#-----------------------------------------------------------------#\n'
);

console.log(
  '\x1b[36mBasic scenario: Alice deposits twice, Bob and Oscar withdraw\x1b[0m'
);
console.log('Alice balance:\x1b[33m', alice.balance().toString(), '\x1b[0m');
console.log('Bob balance:\x1b[33m', bob.balance().toString(), '\x1b[0m');
console.log('Oscar balance:\x1b[33m', oscar.balance().toString(), '\x1b[0m');
console.log('');

console.log(
  'Alice deposit of Type 1 (100000 tokens) and Type 2 (500000 tokens)...'
);
let aliceNote_1 = await deposit(Field(1), alice);
let aliceNote_2 = await deposit(Field(2), alice);

console.log(
  'Bob claims Type 1 (100000 tokens) and Oscar Type 2 (500000 tokens)...'
);
await withdraw(bob, aliceNote_1);
await withdraw(oscar, aliceNote_2);
console.log(
  'Alice balance:',
  alice.balance().toString(),
  `${alice.balance().toString() === '999999400000' ? '✅' : '❌'}`
);
console.log(
  'Bob balance:',
  bob.balance().toString(),
  `${bob.balance().toString() === '1000000100000' ? '✅' : '❌'}`
);
console.log(
  'Oscar balance:',
  oscar.balance().toString(),
  `${oscar.balance().toString() == '1000000500000' ? '✅' : '❌'}`
);

/** However, if Eve is malicious and finds out Alice's note, she can withdraw the funds
 * before Bob and Oscar. To prevent this, Alice can specify an address to withdraw to
 * when she deposits. This address can be Bob's or Oscar's, or even her own.
 */
console.log('\n\n************************\n');
console.log(
  '\x1b[36mAlice deposits and want Bob to withdraw. To prevent Eve from stealing her funds, Alice specifies an address to withdraw to\x1b[0m \n'
);

console.log('Alice deposit of Type 1 (100000 tokens)...');
let aliceNote_3 = await deposit(Field(1), alice, bob);

console.log('Eve tries to claim Type 1 (100000 tokens)...');
try {
  await withdraw(eve, aliceNote_3);
} catch (error) {
  console.log(
    'Error while Eve tries to claim Type 1 (100000 tokens):',
    '\x1b[31m',
    (error as Error).message.split('\n')[0],
    '\x1b[0m'
  );
}

console.log('Now Bob tries to claim Type 1 (100000 tokens)...');
await withdraw(bob, aliceNote_3);

console.log(
  'Alice balance:\x1b[33m',
  alice.balance().toString(),
  `${alice.balance().toString() === '999999300000' ? '✅' : '❌'}\x1b[0m`
);
console.log(
  'Bob balance:\x1b[33m',
  bob.balance().toString(),
  `${bob.balance().toString() === '1000000200000' ? '✅' : '❌'}\x1b[0m`
);
console.log(
  'Eve balance:\x1b[33m',
  eve.balance().toString(),
  `${eve.balance().toString() === '1000000000000' ? '✅' : '❌'}\x1b[0m`
);
