const hre = require("hardhat");

// Chainlink Functions on Polygon Amoy
// https://docs.chain.link/chainlink-functions/supported-networks
const POLYGON_AMOY_FUNCTIONS_ROUTER =
  "0xC22a79eBA640940ABB6dF0f7982cc119578E11De";
// keccak-style encoding of string "fun-polygon-amoy-1" padded to bytes32
const POLYGON_AMOY_DON_ID =
  "0x66756e2d706f6c79676f6e2d616d6f792d310000000000000000000000000000";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying to Polygon Amoy with account:", deployer.address);

  // Voltage threshold: stored as voltage * 1000 (e.g. 2000 = 2.0 V, 3000 = 3.0 V)
  const voltageThresholdScaled = Number(
    process.env.VOLTAGE_THRESHOLD_SCALED || 3000
  );

  const VoltageAlertNFT = await hre.ethers.getContractFactory("VoltageAlertNFT");
  const contract = await VoltageAlertNFT.deploy(
    POLYGON_AMOY_FUNCTIONS_ROUTER,
    POLYGON_AMOY_DON_ID,
    voltageThresholdScaled
  );
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("VoltageAlertNFT deployed to:", addr);
  console.log(
    "Next: setSubscriptionId on-chain, add this address as a consumer at https://functions.chain.link (Polygon Amoy)."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
