import '@/styles/globals.css'
import type { AppProps } from 'next/app'
import { ChakraProvider } from '@chakra-ui/react'
import { extendTheme } from "@chakra-ui/react"

const theme = extendTheme({
  colors: {
    orange: {
      50: "#fbf1ed",
      // ...
      900: "#d76f48",
    },
    purple: {
      50: "#f4f2fc",
      // ...
      900: "#957de3",
    },
  },
})


export default function App({ Component, pageProps }: AppProps) {

  return (
    <ChakraProvider>
      <Component {...pageProps} />
    </ChakraProvider>
  )
}
