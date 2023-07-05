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
  Input,
} from "@chakra-ui/react";
import { AppInput } from "./mainCard";

export default function BodyCardWithdraw({
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
          Secret
        </Text>
        <Input
          placeholder="Enter secret"
          bg={useColorModeValue("#ffffff", "#957de3")}
          borderRadius={"lg"}
        />
      </Flex>
    </Box>
  );
}
