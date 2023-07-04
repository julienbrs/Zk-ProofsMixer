import { fetchAccount, PublicKey, PrivateKey, Field } from "snarkyjs";

import type {
  ZkappWorkerRequest,
  ZkappWorkerReponse,
  WorkerFunctions,
} from "./zkappWorker";

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
    witness: Field,
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
    nullifierWitness: Field,
    commitmentWitness: Field,
    nonce: number,
    depositType: Field,
    specificAddressField: Field
  ) {
    return this._call("createWithdrawTransaction", {
      nullifier,
      nullifierWitness,
      commitmentWitness,
      nonce,
      depositType,
      specificAddressField
    });
  }

  proveCurrentTransaction() {
    return this._call("proveCurrentTransaction", {});
  }

  async getTransactionJSON() {
    const result = await this._call("getTransactionJSON", {});
    return result;
  }

  // ---------------------------------------------------------------------------------------

  worker: Worker;

  promises: {
    [id: number]: { resolve: (res: any) => void; reject: (err: any) => void };
  };

  nextId: number;

  constructor() {
    this.worker = new Worker(new URL("./zkappWorker.ts", import.meta.url));
    this.promises = {};
    this.nextId = 0;

    this.worker.onmessage = (event: MessageEvent<ZkappWorkerReponse>) => {
      this.promises[event.data.id].resolve(event.data.data);
      delete this.promises[event.data.id];
    };
  }

  _call(fn: WorkerFunctions, args: any) {
    return new Promise((resolve, reject) => {
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
