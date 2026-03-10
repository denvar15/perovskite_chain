require("@nomicfoundation/hardhat-toolbox");
const { subtask } = require("hardhat/config");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun", // required for OpenZeppelin 5.x (mcopy)
    },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

// Remap so @chainlink/contracts imports resolve; resolver expects "node_modules/..." for library strip.
subtask("compile:solidity:get-remappings", async () => ({
  "@chainlink/contracts/": "node_modules/@chainlink/contracts/",
}));
