import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { Banner, BrandLine } from "./Banner";
import type { Theme } from "../theme";

interface HomeProps {
  theme: Theme;
  tagline?: string;
  /** Width of the centred composer column. */
  width?: number;
  children: ReactNode;
}

/**
 * The HiraxCode home screen: a centred two-tone logo above a centred
 * composer, with the rest of the column left empty.
 */
export function Home({ theme: t, tagline, width = 78, children }: HomeProps) {
  return (
    <Box
      flexGrow={1}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      paddingX={2}
    >
      <Banner theme={t} />
      <Box marginTop={1}>
        <BrandLine t={t} />
      </Box>
      {tagline ? (
        <Box marginTop={1}>
          <Text color={t.textDim}>{tagline}</Text>
        </Box>
      ) : null}

      <Box marginTop={2} width={width} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
