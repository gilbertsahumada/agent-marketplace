import { getAddress, isAddressEqual, type Address, type Hex } from "viem";
import { ERC1967_IMPLEMENTATION_SLOT, ERC8183_MAINNET } from "./contracts.ts";

interface ImplementationReader {
  getBlockNumber(): Promise<bigint>;
  getStorageAt(args: { address: Address; slot: Hex; blockNumber: bigint }): Promise<Hex | undefined>;
}

function implementationAddress(value: Hex | undefined): Address | null {
  if (!value || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) return null;
  return getAddress(`0x${value.slice(-40)}`);
}

/** Pin both upgradeable contracts at an explicit historical block or the current block. */
export async function mainnetImplementationPinsMatch(
  client: ImplementationReader,
  blockNumber?: bigint,
): Promise<boolean> {
  const checkedBlock = blockNumber ?? await client.getBlockNumber();
  const [commerceStorage, routerStorage] = await Promise.all([
    client.getStorageAt({ address: ERC8183_MAINNET.commerce, slot: ERC1967_IMPLEMENTATION_SLOT, blockNumber: checkedBlock }),
    client.getStorageAt({ address: ERC8183_MAINNET.router, slot: ERC1967_IMPLEMENTATION_SLOT, blockNumber: checkedBlock }),
  ]);
  const commerce = implementationAddress(commerceStorage);
  const router = implementationAddress(routerStorage);
  return Boolean(
    commerce && router &&
    isAddressEqual(commerce, ERC8183_MAINNET.commerceImplementation) &&
    isAddressEqual(router, ERC8183_MAINNET.routerImplementation),
  );
}
