/**
 * Example: trigger a voltage check from IPFS via the deployed VoltageAlertNFT contract.
 * Usage:
 *   CONTRACT_ADDRESS=0x... IPFS_CID=Qm... node scripts/requestVoltageCheck.js
 * Or with full gateway URL:
 *   CONTRACT_ADDRESS=0x... IPFS_GATEWAY_URL="https://gateway.pinata.cloud/ipfs/Qm..." node scripts/requestVoltageCheck.js
 */
const hre = require("hardhat");

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const IPFS_CID = process.env.IPFS_CID;
const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || (IPFS_CID ? `https://gateway.pinata.cloud/ipfs/${IPFS_CID}` : null);

async function main() {
  if (!CONTRACT_ADDRESS || !IPFS_GATEWAY_URL) {
    console.error("Set CONTRACT_ADDRESS and either IPFS_CID or IPFS_GATEWAY_URL");
    process.exit(1);
  }
  const contract = await hre.ethers.getContractAt("VoltageAlertNFT", CONTRACT_ADDRESS);
  const tx = await contract.requestVoltageCheck(IPFS_GATEWAY_URL);
  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Done. Block:", receipt.blockNumber);
}

main().catch((e) => { console.error(e); process.exit(1); });
