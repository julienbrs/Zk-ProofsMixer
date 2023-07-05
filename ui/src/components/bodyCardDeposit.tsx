import { ChevronDownIcon } from "@chakra-ui/icons";
import { useColorModeValue, Flex, Menu, MenuButton, Button, MenuList, MenuItem, Text, Box } from "@chakra-ui/react";

export default function BodyCardDeposit() {
    return (
        <Box bg={useColorModeValue("#f7e2da", "#f4f2fc")} borderRadius={"xl"} mx={6} p={4}>
            <Flex direction="column">
                <Text fontSize="md" fontWeight="semibold" mb={2}>
                    Token
                </Text>
                <Menu>
                    <MenuButton as={Button} rightIcon={<ChevronDownIcon />} w={"100%"} bg={useColorModeValue("#f4f2fc", "#957de3")} borderRadius={"lg"}>
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
                    <Button borderRadius="lg" w={"15%"} fontSize={"sm"}>
                        1
                    </Button>
                    <Button borderRadius="lg" w={"15%"} fontSize={"sm"} py={0}>
                        5
                    </Button>
                    <Button borderRadius="lg" w={"15%"} fontSize={"sm"}>
                        10
                    </Button>
                </Flex>
            </Flex>

        </Box>
    )
}