import { fetchAccount, PublicKey, Field, MerkleMapWitness, UInt32 } from "snarkyjs";

import type {
  ZkappWorkerRequest,
  ZkappWorkerReponse,
  WorkerFunctions,
} from "./zkappWorker";

import { DepositEvent, WithdrawEvent } from "@contracts/types";

export default class ZkappWorkerClient {
  // ---------------------------------------------------------------------------------------

  setActiveInstanceToBerkeley() {
    return this._call("setActiveInstanceToBerkeley", {});
  }

  loadContract() {
    return this._call("loadContract", {});
  }

  compileContract() {
    return this._call("compileContract", {});
  }

  fetchAccount({
    publicKey,
  }: {
    publicKey: PublicKey;
  }): ReturnType<typeof fetchAccount> {
    const result = this._call("fetchAccount", {
      publicKey58: publicKey.toBase58(),
    });
    return result as ReturnType<typeof fetchAccount>;
  }

  async fetchNonce({
    publicKey,
  }: {
    publicKey: PublicKey;
  }) {
    const result = await this._call("fetchNonce", {
      publicKey58: publicKey.toBase58(),
    });
    console.log("fetchNonce", result)
    return new UInt32(parseInt(result as string));
  }

  initZkappInstance(publicKey: PublicKey) {
    return this._call("initZkappInstance", {
      publicKey58: publicKey.toBase58(),
    });
  }

  async getCommitmentsRoot(): Promise<Field> {
    const result = await this._call("getCommitmentsRoot", {});
    return Field.fromJSON(JSON.parse(result as string));
  }

  async getNullifierHashesRoot(): Promise<Field> {
    const result = await this._call("getNullifierHashesRoot", {});
    return Field.fromJSON(JSON.parse(result as string));
  }

  createDepositTransaction(
    commitment: Field,
    witness: MerkleMapWitness,
    depositType: Field
  ) {
    return this._call("createDepositTransaction", {
      commitment,
      witness,
      depositType,
    });
  }

  createWithdrawTransaction(
    nullifier: Field,
    nullifierWitness: MerkleMapWitness,
    commitmentWitness: MerkleMapWitness,
    nonce: UInt32,
    depositType: Field,
    specificAddressField: Field
  ) {
    return this._call("createWithdrawTransaction", {
      nullifier,
      nullifierWitness,
      commitmentWitness,
      nonce,
      depositType,
      specificAddressField,
    });
  }

  proveCurrentTransaction() {
    return this._call("proveCurrentTransaction", {});
  }

  async getTransactionJSON() {
    const result = await this._call("getTransactionJSON", {});
    return result;
  }

  async fetchDepositEvents(): Promise<DepositEvent[]> {
    const result = await this._call("fetchDepositEvents", {});
    return JSON.parse(result as string);
  }

  async fetchWithdrawEvents(): Promise<WithdrawEvent[]> {
    const result = await this._call("fetchWithdrawEvents", {});
    return JSON.parse(result as string);
  }

  // ---------------------------------------------------------------------------------------

  worker: Worker;

  promises: {
    [id: number]: { resolve: (res: any) => void; reject: (err: any) => void };
  };

  nextId: number;

  isReady: boolean;

  async waitUntilReady() {
    if (!this.isReady) {
      // send a message to the worker to check if it's ready
      this.worker.postMessage({ id: -1, fn: "isReady" });

      // when we get a response, set isReady to true
      const handleReady = (event: MessageEvent<ZkappWorkerReponse>) => {
        if (event.data.id === -1) {
          this.isReady = true;
        }
      };
      this.worker.addEventListener("message", handleReady);

      // while we're not ready, wait 100ms and check again
      await new Promise((resolve) => {
        const interval = setInterval(() => {
          if (this.isReady) {
            clearInterval(interval);
            this.worker.removeEventListener("message", handleReady);
            resolve(null);
          } else {
            this.worker.postMessage({ id: -1, fn: "isReady" });
          }
        }, 100);
      });
    }
  }

  constructor() {
    this.worker = new Worker(new URL("./zkappWorker.ts", import.meta.url), {
      type: "module",
    });
    this.promises = {};
    this.nextId = 0;
    this.isReady = false;

    this.waitUntilReady().then(() => {
      this.worker.onmessage = (event: MessageEvent<ZkappWorkerReponse>) => {
        this.promises[event.data.id].resolve(event.data.data);
        delete this.promises[event.data.id];
      };
    });
  }

  _call(fn: WorkerFunctions, args: any) {
    return new Promise(async (resolve, reject) => {
      await this.waitUntilReady();
      this.promises[this.nextId] = { resolve, reject };

      const message: ZkappWorkerRequest = {
        id: this.nextId,
        fn,
        args,
      };

      this.worker.postMessage(message);

      this.nextId++;
    });
  }
}
