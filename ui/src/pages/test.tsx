
// page of test
import React from 'react';

import { Box, Button, Flex, Heading, Link, Text } from '@chakra-ui/react';


import MainCard from '@/components/mainCard';

export default function Test() {
    return (
        <Box>
            <Flex
                direction="column"
                align="center"
                justify="center"
                h="100vh"
                bgGradient="linear(to-l, #7928CA, #FF0080)"
            >
                <MainCard />
            </Flex>
        </Box>
    );
}