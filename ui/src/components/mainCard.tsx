/* eslint-disable react-hooks/rules-of-hooks */
import {
  Card,
  CardHeader,
  CardFooter,
  Button,
  Flex,
  Icon,
  Text,
  Spinner,
  Box,
} from "@chakra-ui/react";
import { SettingsIcon } from "@chakra-ui/icons";
import { useState } from "react";
import BodyCardDeposit from "./bodyCardDeposit";
import BodyCardWithdraw from "./bodyCardWithdraw";
import FooterDeposit from "./footerDeposit";
import FooterWithdraw from "./footerWithdraw";
import { AppState } from "@/pages";
import { Field, Poseidon, PublicKey } from "snarkyjs";
import { DepositNote } from "@contracts/types";
import { parseDepositNote } from "@/utils/notes";

let transactionFee = 0.1;

export type AppInput = {
  depositType: 1 | 2 | 3;
  addressToWithdraw: null | PublicKey;
  withdrawNote: string;
};

export default function MainCard({
  state,
  setState,
  status,
  setStatus
}: {
  state: AppState;
  setState: (state: AppState) => void;
  status: string;
  setStatus: (status: string) => void;
}) {
  const [input, setInput] = useState<AppInput>({
    depositType: 1,
    addressToWithdraw: null,
    withdrawNote: "",
  });
  const [depositNote, setDepositNote] = useState<null | DepositNote>(null);

  const debug = (
    <div>
      <h2>Debug</h2>
      <code>
        <span>state:</span>
        <pre>{JSON.stringify(state, null, 2)}</pre>

        <span>input:</span>
        <pre>{JSON.stringify(input, null, 2)}</pre>

        <span>depositNote:</span>
        <pre>{JSON.stringify(depositNote, null, 2)}</pre>

        <span>Status:</span>
        <pre>{JSON.stringify(status, null, 2)}</pre>
      </code>
    </div>
  );

  const [view, setView] = useState("deposit"); // 'deposit' or 'withdraw'

  // -------------------------------------------------------
  // Transaction handling

  const onSendDepositTransaction = async () => {
    setState({ ...state, creatingDepositTransaction: true });
    setStatus("Deposit...");

    const depositType = Field(input.depositType);
    const addressToWithdraw =
      input.addressToWithdraw?.toFields()[0] ?? Field(0);

    const caller = await state.zkappWorkerClient!.fetchAccount({
      publicKey: state.publicKey!,
    });

    if (caller.error != null) {
      throw new Error("No account");
    }

    // get caller's information
    const depositNonce = await state.zkappWorkerClient!.fetchNonce({
      publicKey: state.publicKey!,
    });
    const nullifier = Field.random();

    console.log(depositNonce)

    // calculate the commitment. If `addressToWithdraw` is Field(0), then it won't change the hash
    // and the deposit will be withdrawable to any address that got the note
    const commitment = Poseidon.hash(
      [
        depositNonce.toFields(),
        nullifier,
        depositType,
        addressToWithdraw,
      ].flat()
    );

    // get the witness for the current tree
    const commitmentWitness = state.localCommitmentsMap!.getWitness(commitment);

    // on-chain deposit
    await state.zkappWorkerClient!.createDepositTransaction(
      commitment,
      commitmentWitness,
      depositType
    );

    console.log("creating proof...");
    await state.zkappWorkerClient!.proveCurrentTransaction();

    console.log("getting Transaction JSON...");
    const transactionJSON = await state.zkappWorkerClient!.getTransactionJSON();

    console.log("requesting deposit transaction...");
    const { hash } = await (window as any).mina.sendTransaction({
      transaction: transactionJSON,
      feePayer: {
        fee: transactionFee,
        memo: "",
      },
    });

    setStatus(
      "See transaction at https://berkeley.minaexplorer.com/transaction/" + hash
    );

    // update the leaf locally if the deposit was successful
    state.localCommitmentsMap?.set(commitment, depositType);

    // save necessary information for withdrawal
    setDepositNote({
      nonce: depositNonce,
      commitment,
      nullifier,
      depositType,
      addressToWithdraw,
    });

    setStatus("Done!");
    setState({
      ...state,
      creatingDepositTransaction: false,
    });
  };

  const onSendWithdrawTransaction = async () => {
    setState({ ...state, creatingWithdrawTransaction: true });
    setStatus("Withdraw...");

    const note = parseDepositNote(input.withdrawNote);
    console.log("withdraw note", note);

    const addressToWithdraw =
      input.addressToWithdraw?.toFields()[0] ?? Field(0);

    await state.zkappWorkerClient!.fetchAccount({
      publicKey: state.publicKey!,
    });

    // calculate the expected commitment used when depositing
    const expectedCommitment = Poseidon.hash(
      [
        note.nonce.toFields(),
        note.nullifier,
        note.depositType,
        addressToWithdraw,
      ].flat()
    );

    // hash the nullifier
    const nullifierHashed = Poseidon.hash([note.nullifier]);

    // get witnesses for the current tree...
    const commitmentWitness =
      state.localCommitmentsMap!.getWitness(expectedCommitment);
    const nullifierWitness =
      state.localNullifierHashedRoot!.getWitness(nullifierHashed);

    // ... and update the leaf locally
    state.localNullifierHashedRoot!.set(expectedCommitment, note.depositType);

    await state.zkappWorkerClient!.createWithdrawTransaction(
      note.nullifier,
      nullifierWitness,
      commitmentWitness,
      note.nonce,
      note.depositType,
      addressToWithdraw
    );

    console.log("creating proof...");
    await state.zkappWorkerClient!.proveCurrentTransaction();

    console.log("getting Transaction JSON...");
    const transactionJSON = await state.zkappWorkerClient!.getTransactionJSON();

    console.log("requesting withdraw transaction...");
    const { hash } = await (window as any).mina.sendTransaction({
      transaction: transactionJSON,
      feePayer: {
        fee: transactionFee,
        memo: "",
      },
    });

    console.log(
      "See transaction at https://berkeley.minaexplorer.com/transaction/" + hash
    );

    setStatus("Done!");
    setState({ ...state, creatingWithdrawTransaction: false });
  };

  const handleButtonClick = (newView: any) => {
    setView(newView);
  };

  return (
    <Card w={"23%"} boxShadow="dark-lg" bg="purple.50" borderRadius={"3xl"}>
      {!state.hasBeenSetup && (
        <Box
          borderRadius={"3xl"}
          backdropFilter={"auto"}
          backdropBlur="4px"
          w={"100%"}
          h={"100%"}
          position="absolute"
          top={0}
          left={0}
          bg="rgba(255,255,255,0.5)"
          zIndex={100}
        >
          <Flex flexDir={"column"} justify="center" align="center" h="100%">
            <Spinner />
            <Text align={"center"} fontSize="xl" color="gray.800">
              {status}
            </Text>
          </Flex>
        </Box>
      )}
      <CardHeader>
        <Flex justify="space-between" align="center">
          <Flex gap={2}>
            <Button
              onClick={() => handleButtonClick("deposit")}
              bg={view === "deposit" ? "#d76f48" : "#f7e2da"}
              color={view === "deposit" ? "white" : "black"}
              _hover={{ bg: view === "deposit" ? "#b6633e" : "#c1b1a0" }}
            >
              Deposit
            </Button>
            <Button
              onClick={() => handleButtonClick("withdraw")}
              bg={view === "withdraw" ? "#d76f48" : "#f7e2da"}
              color={view === "withdraw" ? "white" : "black"}
              _hover={{ bg: view === "withdraw" ? "#b6633e" : "#c1b1a0" }}
            >
              Withdraw
            </Button>
          </Flex>
          <Icon as={SettingsIcon} w={4} h={4} />
        </Flex>
      </CardHeader>
      {view === "deposit" && <BodyCardDeposit input={input} setInput={setInput} />}
      {view === "withdraw" && <BodyCardWithdraw input={input} setInput={setInput} />}

      <CardFooter>
        <Box w={"100%"}>
          {view === "deposit" && <FooterDeposit onDeposit={onSendDepositTransaction} />}
          {view === "withdraw" && <FooterWithdraw onWithdraw={onSendWithdrawTransaction} />}
        </Box>
      </CardFooter>
    </Card>
  );
}
