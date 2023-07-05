import {
  Field,
  MerkleMapWitness,
  Mina,
  PublicKey,
  UInt32,
  fetchAccount,
} from "snarkyjs";

type Transaction = Awaited<ReturnType<typeof Mina.transaction>>;

// ---------------------------------------------------------------------------------------

import type { ZkMixer } from "@contracts/zkMixer";
import { fetchDepositEvents, fetchWithdrawEvents} from "@contracts/utils";

const state = {
  ZkMixer: null as null | typeof ZkMixer,
  zkapp: null as null | ZkMixer,
  transaction: null as null | Transaction,
};

// ---------------------------------------------------------------------------------------

const functions = {
  setActiveInstanceToBerkeley: async (args: {}) => {
    console.log("setActiveInstanceToBerkeley");
    const Berkeley = Mina.Network(
      "https://proxy.berkeley.minaexplorer.com/graphql"
    );
    Mina.setActiveInstance(Berkeley);
  },

  loadContract: async (args: {}) => {
    const { ZkMixer } = await import("@contracts/zkMixer");
    state.ZkMixer = ZkMixer;
  },

  compileContract: async (args: {}) => {
    await state.ZkMixer!.compile();
  },

  fetchAccount: async (args: { publicKey58: string }) => {
    const publicKey = PublicKey.fromBase58(args.publicKey58);
    return await fetchAccount({ publicKey });
  },

  initZkappInstance: async (args: { publicKey58: string }) => {
    const publicKey = PublicKey.fromBase58(args.publicKey58);
    state.zkapp = new state.ZkMixer!(publicKey);
  },

  getCommitmentsRoot: async (args: {}) => {
    const currentCommitmentsRoot = await state.zkapp!.commitmentsRoot.get();
    return JSON.stringify(currentCommitmentsRoot.toJSON());
  },

  getNullifierHashesRoot: async (args: {}) => {
    const currentNullifierHashesRoot =
      await state.zkapp!.nullifierHashesRoot.get();
    return JSON.stringify(currentNullifierHashesRoot.toJSON());
  },

  createDepositTransaction: async (arg: {
    commitment: Field;
    witness: MerkleMapWitness;
    depositType: Field;
  }) => {
    const transaction = await Mina.transaction(() => {
      state.zkapp!.deposit(arg.commitment, arg.witness, arg.depositType);
    });
    state.transaction = transaction;
  },

  createWithdrawTransaction: async (arg: {
    nullifier: Field;
    nullifierWitness: MerkleMapWitness;
    commitmentWitness: MerkleMapWitness;
    nonce: UInt32;
    depositType: Field;
    specificAddressField: Field;
  }) => {
    const transaction = await Mina.transaction(() => {
      state.zkapp!.withdraw(
        arg.nullifier,
        arg.nullifierWitness,
        arg.commitmentWitness,
        arg.nonce,
        arg.depositType,
        arg.specificAddressField
      );
    });
    state.transaction = transaction;
  },

  proveCurrentTransaction: async (args: {}) => {
    await state.transaction!.prove();
  },

  getTransactionJSON: async (args: {}) => {
    return state.transaction!.toJSON();
  },

  fetchDepositEvents: async (args: {}) => {
    return JSON.stringify(await fetchDepositEvents(state.zkapp!));
  },

  fetchWithdrawEvents: async (args: {}) => {
    return JSON.stringify(await fetchWithdrawEvents(state.zkapp!));
  }
};

// ---------------------------------------------------------------------------------------

export type WorkerFunctions = keyof typeof functions;

export type ZkappWorkerRequest = {
  id: number;
  fn: WorkerFunctions | "isReady";
  args: any;
};

export type ZkappWorkerReponse = {
  id: number;
  data: any;
};

self.onmessage = async (event: MessageEvent<ZkappWorkerRequest>) => {
  if (event.data.fn === "isReady") {
    postMessage({ id: -1 });
    return;
  }

  const returnData = await functions[event.data.fn](event.data.args);

  const message: ZkappWorkerReponse = {
    id: event.data.id,
    data: returnData,
  };
  postMessage(message);
};
