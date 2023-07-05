/* eslint-disable react-hooks/rules-of-hooks */
import { Card, CardHeader, CardBody, CardFooter, Button, Flex, Icon, Text, Menu, MenuButton, MenuItem, MenuList, useColorModeValue, Box } from '@chakra-ui/react'
import { ChevronDownIcon, SettingsIcon } from '@chakra-ui/icons'
import { useState } from 'react';
import BodyCardDeposit from './bodyCardDeposit';
import BodyCardWithdraw from './bodyCardWithdraw';
import FooterDeposit from './footerDeposit';
import FooterWithdraw from './footerWithdraw';

export default function MainCard() {
    const [view, setView] = useState('deposit'); // 'deposit' or 'withdraw'

    const handleButtonClick = (newView: any) => {
        setView(newView);
    };

    return (
        <Card w={"23%"} boxShadow="dark-lg" bg="purple.50" borderRadius={"3xl"}>
            <CardHeader>
                <Flex justify="space-between" align="center">
                    <Flex gap={2}>
                        <Button onClick={() => handleButtonClick('deposit')} bg={view === 'deposit' ? '#d76f48' : '#f7e2da'}
                            color={view === 'deposit' ? 'white' : 'black'} _hover={{ bg: view === 'deposit' ? '#b6633e' : '#c1b1a0' }}>
                            Deposit
                        </Button>
                        <Button onClick={() => handleButtonClick('withdraw')} bg={view === 'withdraw' ? '#d76f48' : '#f7e2da'}
                            color={view === 'withdraw' ? 'white' : 'black'} _hover={{ bg: view === 'withdraw' ? '#b6633e' : '#c1b1a0' }}>
                            Withdraw
                        </Button>
                    </Flex>
                    <Icon as={SettingsIcon} w={4} h={4} />
                </Flex>
            </CardHeader>
            {view === 'deposit' && (
                <BodyCardDeposit />
            )}
            {view === 'withdraw' && (
                <BodyCardWithdraw />
            )}

            <CardFooter>
                <Box w={"100%"} >
                    {view === 'deposit' && (
                        <FooterDeposit />
                    )}
                    {view === 'withdraw' && (

                        <FooterWithdraw />
                    )}

                </Box>
            </CardFooter>
        </Card>
    )
}