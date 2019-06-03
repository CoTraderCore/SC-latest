/* globals artifacts, web3 */
const CoTraderCrowdsale = artifacts.require('./CoTraderCrowdsale.sol')
const CoTraderToken = artifacts.require('./CoTraderToken.sol')

const RATE = 1200000
const ETH_HARDCAP = 2000
const CAP = RATE * ETH_HARDCAP

// const OPENING_TIME = 6000000 // TODO
const DURATION = 1000 // TODO
// const CLOSING_TIME = OPENING_TIME + DURATION

module.exports = function(deployer, network, accounts) {
  deployer
    .then(() => {
      return deployer.deploy(CoTraderToken)
    })
    .then(async () => {
      const wallet = accounts[0]
      const tokenWallet = accounts[0]

      const block = await web3.eth.getBlock('latest')
      const openingTime = block.timestamp + 10

      return deployer.deploy(
        CoTraderCrowdsale,
        RATE,
        wallet,
        CoTraderToken.address,
        CAP,
        // OPENING_TIME,
        // CLOSING_TIME,
        openingTime,
        openingTime + DURATION,
        tokenWallet
      )
    })
    .then(async () => {
      // give allowance to crowdsale contract
      const token = await CoTraderToken.deployed()

      await token.approve(CoTraderCrowdsale.address, CAP)
    })
}
