import { Button, Box } from "@chakra-ui/react";

export default function FooterWithdraw() {
    return (
        <Box>
            <Button w={"100%"} bg="#df8c6d" borderRadius={"xl"} color={"white"}
                _hover={{ bg: "#d76f48" }}
                _active={{ bg: "#d76f48" }}>
                Withdraw
            </Button>
        </Box>)
}