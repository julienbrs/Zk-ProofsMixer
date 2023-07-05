import { ChevronDownIcon } from "@chakra-ui/icons";
import {
  useColorModeValue,
  Flex,
  Menu,
  MenuButton,
  Button,
  MenuList,
  MenuItem,
  Text,
  Box,
} from "@chakra-ui/react";
import { AppInput } from "./mainCard";

export default function BodyCardDeposit({
  input,
  setInput,
}: {
  input: AppInput;
  setInput: (input: AppInput) => void;
}) {
  return (
    <Box
      bg={useColorModeValue("#f7e2da", "#f4f2fc")}
      borderRadius={"xl"}
      mx={6}
      p={4}
    >
      <Flex direction="column">
        <Text fontSize="md" fontWeight="semibold" mb={2}>
          Token
        </Text>
        <Menu>
          <MenuButton
            as={Button}
            rightIcon={<ChevronDownIcon />}
            w={"100%"}
            bg={useColorModeValue("#f4f2fc", "#957de3")}
            borderRadius={"lg"}
          >
            MINA
          </MenuButton>

          <MenuList>
            <MenuItem>MINA</MenuItem>
            <MenuItem>More to come</MenuItem>
          </MenuList>
        </Menu>

        <Text fontSize="md" fontWeight="semibold" mt={4} mb={2}>
          Amount
        </Text>
        <Flex justify="space-between" align="center">
          <Button
            border={input.depositType === 1 ? "2px" : "1px"}
            borderColor={input.depositType === 1 ? "#d76f48" : "#f7e2da"}
            borderRadius="lg"
            w={"15%"}
            fontSize={"sm"}
            onClick={() =>
              setInput({
                ...input,
                depositType: 1,
              })
            }
          >
            1
          </Button>
          <Button
            border={input.depositType === 2 ? "2px" : "1px"}
            borderColor={input.depositType === 2 ? "#d76f48" : "#f7e2da"}
            borderRadius="lg"
            w={"15%"}
            fontSize={"sm"}
            py={0}
            onClick={() => {
              setInput({
                ...input,
                depositType: 2,
              });
            }}
          >
            5
          </Button>
          <Button
            border={input.depositType === 3 ? "2px" : "1px"}
            borderColor={input.depositType === 3 ? "#d76f48" : "#f7e2da"}
            borderRadius="lg"
            w={"15%"}
            fontSize={"sm"}
            onClick={() => {
              setInput({
                ...input,
                depositType: 3,
              });
            }}
          >
            10
          </Button>
        </Flex>
      </Flex>
    </Box>
  );
}
