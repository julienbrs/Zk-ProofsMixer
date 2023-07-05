import { DepositNote } from "@contracts/types";
import { Field, UInt32 } from "snarkyjs";

/**
 * Formats a DepositNote object into a deposit note string.
 * The deposit note string will be in the format:
 * <nonce>-<commitment>-<nullifier>-<depositType>-<addressToWithdraw>
 * to base64.
 *
 * @param note The DepositNote object to format.
 * @returns A deposit note string.
 */
const formatDepositNote = (note: DepositNote): string => {
  const { nonce, commitment, nullifier, depositType, addressToWithdraw } =
    note;
  const str = `${nonce.toString()}-${commitment.toString()}-${nullifier.toString()}-${depositType.toString()}-${addressToWithdraw?.toString()}`;
  return btoa(str);
};

/**
 * Parses a deposit note string into a DepositNote object.
 * The deposit note string should be in the format:
 * <nonce>-<commitment>-<nullifier>-<depositType>-<addressToWithdraw>
 * from base64.
 *
 * @param str The deposit note string to parse.
 * @returns A DepositNote object.
 */
const parseDepositNote = (str: string): DepositNote => {
  const [nonce, commitment, nullifier, depositType, addressToWithdraw] =
    atob(str).split("-");
  return {
    nonce: new UInt32(parseInt(nonce)),
    commitment: new Field(commitment),
    nullifier: Field(nullifier),
    depositType: Field(depositType),
    addressToWithdraw: Field(addressToWithdraw),
  };
};

export {
  formatDepositNote,
  parseDepositNote,
}