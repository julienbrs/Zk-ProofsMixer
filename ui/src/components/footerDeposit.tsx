import { Button, Box } from "@chakra-ui/react";

export default function FooterDeposit({
  onDeposit,
}: {
  onDeposit: () => void;
}) {
  return (
    <Box>
      <Button
        w={"100%"}
        bg="#df8c6d"
        borderRadius={"xl"}
        color={"white"}
        onClick={onDeposit}
        _hover={{ bg: "#d76f48" }}
        _active={{ bg: "#d76f48" }}
      >
        Deposit
      </Button>
    </Box>
  );
}
