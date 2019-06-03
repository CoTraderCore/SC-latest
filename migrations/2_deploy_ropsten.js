/* globals artifacts */
const SmartFundRegistry = artifacts.require("./SmartFundRegistry.sol");
const ExchangePortal = artifacts.require("./ExchangePortal.sol");
const PermittedExchanges = artifacts.require("./PermittedExchanges.sol");
const KYBER_ADDRESS = "0x818E6FECD516Ecc3849DAf6845e3EC868087B755";
const PLATFORM_FEE = 1000;

function maybeDeployRopsten(deployer, network) {
  if (network === "ropstenInfura") return deployRopsten(deployer);
  return Promise.resolve(true);
}

function deployRopsten(deployer) {
  return deployer
    .then(() => deployer.deploy(ExchangePortal, KYBER_ADDRESS))
    .then(() => deployer.deploy(PermittedExchanges, ExchangePortal.address))
    .then(() =>
      deployer.deploy(
        SmartFundRegistry,
        PLATFORM_FEE,
        ExchangePortal.address,
        PermittedExchanges.address
      )
    );
}

module.exports = (deployer, network, accounts) => {
  deployer.then(() => maybeDeployRopsten(deployer, network));
};
